import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { PartsModule } from './parts/parts.module';
import { createRedisConnectionOptions } from './queues/redis-connection';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: createRedisConnectionOptions(config),
      }),
    }),
    DatabaseModule,
    StorageModule,
    AuthModule,
    TaxonomyModule,
    AiModule,
    PartsModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
