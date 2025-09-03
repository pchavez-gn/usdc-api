import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { IndexerModule } from './indexer/indexer.module';
import { TransfersController } from './transfers/transfers.controller';

@Module({
  imports: [IndexerModule],
  controllers: [AppController, TransfersController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
