import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
