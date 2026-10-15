import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/** Entry point of the `worker` service: converts uploaded files to PDF. */
async function bootstrap(): Promise<void> {
  // This process exists to run the worker, whatever the shared .env says.
  process.env.CONVERSION_WORKER_ENABLED = 'true';
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
