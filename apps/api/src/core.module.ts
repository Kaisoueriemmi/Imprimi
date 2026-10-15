import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService, validateEnv } from './config/env';
import { buildLoggerParams } from './logging/logger.config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

/** Infrastructure shared by the HTTP API and the conversion worker process. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    PrismaModule,
    StorageModule,
  ],
})
export class CoreModule {}
