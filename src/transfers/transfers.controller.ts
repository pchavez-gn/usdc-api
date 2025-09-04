import { Controller, Get, Param, Query, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    ApiQuery,
    ApiOperation,
    ApiTags,
    ApiParam,
    ApiBody,
} from '@nestjs/swagger';
import { ethers } from 'ethers';
import { PrismaService } from 'src/prisma/prisma.service';
import usdcAbi from 'src/indexer/usdc.abi.json';

@ApiTags('Transfers') // Groups endpoints under "Transfers" in Swagger
@Controller('transfers')
export class TransfersController {
    private provider: ethers.JsonRpcProvider;
    private usdc: ethers.Contract;

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        this.provider = new ethers.JsonRpcProvider(
            this.config.get<string>('ETH_RPC_URL'),
        );

        this.usdc = new ethers.Contract(
            this.config.get<string>('USDC_CONTRACT') ??
            '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            usdcAbi,
            this.provider,
        );
    }

    /**
     * GET /transfers
     * Fetch recent USDC transfers, optionally filtered by sender and/or recipient.
     */
    @Get()
    @ApiOperation({ summary: 'Fetch recent USDC transfers' })
    @ApiQuery({
        name: 'from',
        required: false,
        description: 'Filter by sender address (optional)',
    })
    @ApiQuery({
        name: 'to',
        required: false,
        description: 'Filter by recipient address (optional)',
    })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: 'Maximum number of transfers to return',
        example: 20,
    })
    async getTransfers(
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit = '20',
    ) {
        const transfers = await this.prisma.transfer.findMany({
            where: {
                ...(from ? { from } : {}),
                ...(to ? { to } : {}),
            },
            orderBy: { block: 'desc' },
            take: parseInt(limit),
        });

        return transfers.map((t) => ({
            ...t,
            amount: ethers.formatUnits(t.amount, 6),
        }));
    }

    /**
     * GET /transfers/balance/:address
     * Fetch the USDC balance of a given address directly from the blockchain.
     */
    @Get('balance/:address')
    @ApiOperation({ summary: 'Get USDC balance of an address' })
    @ApiParam({
        name: 'address',
        required: true,
        description: 'Ethereum address to query the balance of',
    })
    async getBalance(@Param('address') address: string) {
        const balance = await this.usdc.balanceOf(address);
        return {
            address,
            balance: ethers.formatUnits(balance, 6), // USDC = 6 decimals
        };
    }

    /**
     * GET /transfers/history/:address
     * Fetch recent transfer history for a given address (sent or received).
     */
    @Get('history/:address')
    @ApiOperation({ summary: 'Get transfer history of an address' })
    @ApiParam({
        name: 'address',
        required: true,
        description: 'Ethereum address to fetch history for',
    })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: 'Maximum number of transfers to return',
        example: 20,
    })
    async getHistory(
        @Param('address') address: string,
        @Query('limit') limit = '20',
    ) {
        return this.prisma.transfer.findMany({
            where: {
                OR: [{ from: address }, { to: address }],
            },
            orderBy: { block: 'desc' },
            take: parseInt(limit),
        });
    }

    /**
     * POST /transfers/transfer
     * Simulate a USDC transfer from a wallet private key (demo only, does NOT execute on-chain)
     */

    @Post('transfer')
    @ApiOperation({ summary: 'Simulate a USDC transfer (demo only, no real transaction)' })
    @ApiBody({
        description: 'Transfer parameters',
        required: true,
        schema: {
            type: 'object',
            properties: {
                fromPk: { type: 'string', description: 'Sender private key' },
                to: { type: 'string', description: 'Recipient Ethereum address' },
                amount: { type: 'string', description: 'Amount of USDC to transfer (as string, e.g., "10.5")' },
            },
            required: ['fromPk', 'to', 'amount'],
        },
    })
    async simulateTransferDemo(@Body() body: { fromPk: string; to: string; amount: string }) {
        try {
            // Create wallet locally (does not broadcast any transaction)
            const wallet = new ethers.Wallet(body.fromPk);

            // Prepare a transaction object (but do not send it)
            const unsignedTx = await this.usdc.transfer.populateTransaction(
                body.to,
                ethers.parseUnits(body.amount, 6),
            );

            // Fill in basic details
            unsignedTx.from = wallet.address;

            let estimatedGas: string | null = null;

            try {
                const gas = await this.provider.estimateGas({
                    ...unsignedTx,
                    from: wallet.address,
                });
                estimatedGas = gas.toString();
            } catch (err: any) {
                // Gas estimation failed (likely due to insufficient balance or allowance)
                return {
                    success: false,
                    message: err.reason ?? 'Gas estimation failed',
                    from: wallet.address,
                    to: body.to,
                    amount: body.amount,
                    txData: unsignedTx,
                    error: err.shortMessage ?? err.message,
                };
            }

            return {
                success: true,
                message: 'This is a simulated transfer. No funds were moved on-chain.',
                from: wallet.address,
                to: body.to,
                amount: body.amount,
                txData: unsignedTx,
                estimatedGas,
            };
        } catch (err: any) {
            throw new HttpException(
                {
                    success: false,
                    message: 'Simulation failed',
                    error: err.message,
                },
                HttpStatus.BAD_REQUEST,
            );
        }
    }
}
