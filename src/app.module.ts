import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IndexerModule } from './indexer/indexer.module';
import { TransfersController } from './transfers/transfers.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    IndexerModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
  ],
  controllers: [AppController, TransfersController],
  providers: [AppService],
})
export class AppModule {}
