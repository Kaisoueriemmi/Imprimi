import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfiguredIoAdapter } from './common/io-adapter';
import { AppConfigService } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfigService>(ConfigService);

  // Behind Caddy in production: trust the first proxy for client IPs (rate limiting).
  app.set('trust proxy', 1);
  app.use(helmet());
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, corsOrigins));
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
