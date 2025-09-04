import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ethers, Contract, Filter } from 'ethers';
import { ConfigService } from '@nestjs/config';
import usdcAbi from 'src/indexer/usdc.abi.json';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

@Injectable()
export class IndexerService implements OnModuleInit {
    private provider: ethers.JsonRpcProvider;
    private usdc: Contract & { address: string };
    private transferTopic: string;
    private readonly logger = new Logger(IndexerService.name);

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        const rpcUrl = this.config.get<string>('ETH_RPC_URL')!;
        this.provider = new ethers.JsonRpcProvider(rpcUrl);

        this.usdc = new ethers.Contract(
            this.config.get<string>('USDC_CONTRACT')!,
            usdcAbi,
            this.provider,
        ) as Contract & { address: string };

        const transferEvent = this.usdc.interface.getEvent('Transfer');
        if (!transferEvent) {
            throw new Error("Transfer event not found in USDC ABI");
        }
        this.transferTopic = ethers.id(transferEvent.format());
    }

    async onModuleInit() {
        await this.startIndexer();
    }

    async startIndexer() {
        try {
            await this.handleReorgs();
            await this.fetchLogs();
            await this.deleteOldTransfers();
        } catch (err) {
            this.logger.error('Indexer loop error', err as any);
        }
    }

    private async getLastIndexedBlock(): Promise<{ block: number; blockHash: string } | null> {
        return await this.prisma.transfer.findFirst({
            orderBy: { block: 'desc' },
            select: { block: true, blockHash: true },
        });
    }

    /** Check if last saved block is still canonical, rollback if not */
    private async handleReorgs(): Promise<void> {
        const last = await this.getLastIndexedBlock();
        if (!last) return;

        const chainBlock = await this.provider.getBlock(last.block);
        if (!chainBlock || chainBlock.hash !== last.blockHash) {
            this.logger.warn(`⚠️ Reorg detected at block ${last.block}, rolling back...`);
            await this.prisma.transfer.deleteMany({
                where: { block: { gte: last.block } },
            });
        }
    }

    private async fetchLogs() {
        const CHUNK_SIZE = this.config.get<number>('MAX_BLOCKS', 5);
        const MAX_INDEXER_SIZE = this.config.get<number>('MAX_INDEXER_SIZE', 1000);
        const CONFIRMATIONS = this.config.get<number>('CONFIRMATIONS', 12);

        let transferCount = 0;
        const lastIndexed = (await this.getLastIndexedBlock())?.block || 0;
        const latestBlock = await this.provider.getBlockNumber();
        const safeBlock = latestBlock - CONFIRMATIONS;

        let toBlock = safeBlock;
        let fromBlock = Math.max(lastIndexed + 1, toBlock - CHUNK_SIZE + 1);

        // Exponential backoff helper
        const fetchWithRetry = async <T>(
            fn: () => Promise<T>,
            retries = 5,
            delay = 1000 // initial delay in ms
        ): Promise<T> => {
            try {
                return await fn();
            } catch (err) {
                if (retries === 0) throw err;
                const backoff = delay * 2;
                const jitter = Math.random() * 300; // add small random jitter
                const waitTime = backoff + jitter;
                this.logger.warn(`Retrying in ${waitTime.toFixed(0)}ms... (${retries} retries left)`);
                await new Promise((res) => setTimeout(res, waitTime));
                return fetchWithRetry(fn, retries - 1, backoff);
            }
        };

        while (transferCount < MAX_INDEXER_SIZE && fromBlock <= toBlock) {
            this.logger.log(`Fetching logs from block ${fromBlock} to ${toBlock}`);

            const filter: Filter = {
                address: this.usdc.address,
                topics: [this.transferTopic],
                fromBlock,
                toBlock,
            };

            try {
                const logs = await fetchWithRetry(() => this.provider.getLogs(filter));
                await sleep(300);
                const blockCache = new Map<number, { hash: string; timestamp: Date }>();

                const transfers = await Promise.all(
                    logs.map(async (log) => {
                        try {
                            const parsed = this.usdc.interface.parseLog(log);

                            let blockData = blockCache.get(log.blockNumber);
                            if (!blockData) {
                                const block = await this.provider.getBlock(log.blockNumber);
                                if (!block) throw new Error(`Block ${log.blockNumber} not found`);
                                blockData = {
                                    hash: block.hash!,
                                    timestamp: new Date(block.timestamp * 1000),
                                };
                                blockCache.set(log.blockNumber, blockData);
                            }

                            return {
                                txHash: log.transactionHash,
                                logIndex: log.index,
                                block: log.blockNumber,
                                blockHash: blockData.hash,
                                from: parsed!.args.from,
                                to: parsed!.args.to,
                                amount: parsed!.args.value.toString(),
                                timestamp: blockData.timestamp,
                            };
                        } catch (err) {
                            // skip invalid logs
                            return null;
                        }
                    })
                );

                const validTransfers = transfers.filter(
                    (tx): tx is NonNullable<typeof tx> => tx !== null
                );

                if (validTransfers.length > 0) {
                    await this.prisma.transfer.createMany({
                        data: validTransfers,
                        skipDuplicates: true,
                    });
                }

                this.logger.log(
                    `Inserted ${validTransfers.length} transfers for blocks ${fromBlock}-${toBlock}`
                );

                transferCount += validTransfers.length;

                toBlock = fromBlock - 1;
                fromBlock = Math.max(lastIndexed + 1, toBlock - CHUNK_SIZE + 1);
            } catch (err) {
                this.logger.error(`Error fetching logs for blocks ${fromBlock}-${toBlock}`, err);
                throw err;
            }
        }
    }

    private async deleteOldTransfers(): Promise<void> {
        const MAX_INDEXER_SIZE = this.config.get<number>('MAX_INDEXER_SIZE', 1000);
        const totalTransfers = await this.prisma.transfer.count();
        const excess = totalTransfers - MAX_INDEXER_SIZE;

        if (excess > 0) {
            this.logger.log(`Deleting ${excess} old transfers to maintain the ${MAX_INDEXER_SIZE}-record limit.`);
            await this.prisma.transfer.deleteMany({
                where: {
                    id: {
                        in: (
                            await this.prisma.transfer.findMany({
                                orderBy: { block: 'asc' },
                                take: excess,
                                select: { id: true },
                            })
                        ).map((transfer) => transfer.id),
                    },
                },
            });
        }
    }
}
