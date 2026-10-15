import { Global, type INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PrismaHealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { InMemoryStorageService } from '../storage/in-memory-storage.service';
import { StorageService } from '../storage/storage.service';
import { HealthModule } from './health.module';

async function createApp(deps: { database: boolean; storage: boolean }): Promise<INestApplication> {
  const fakeIndicator = {
    pingCheck: async (key: string): Promise<HealthIndicatorResult> => ({
      [key]: { status: deps.database ? 'up' : 'down' },
    }),
  };
  const storage = new InMemoryStorageService();
  if (!deps.storage) {
    storage.ping = async () => {
      throw new Error('bucket unreachable');
    };
  }

  // Mirrors the real @Global() Prisma and Storage modules, with nothing behind them.
  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: {} },
      { provide: StorageService, useValue: storage },
    ],
    exports: [PrismaService, StorageService],
  })
  class FakeInfraModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [FakeInfraModule, HealthModule],
    // The global API error filter must not swallow terminus' detailed 503 body.
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
  })
    .overrideProvider(PrismaHealthIndicator)
    .useValue(fakeIndicator)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('GET /health', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 when database and storage are up', async () => {
    app = await createApp({ database: true, storage: true });
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, storage: { status: 'up' } },
    });
  });

  it('returns 503 when the database is down', async () => {
    app = await createApp({ database: false, storage: true });
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', error: { database: { status: 'down' } } });
  });

  it('returns 503 when the storage is down', async () => {
    app = await createApp({ database: true, storage: false });
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', error: { storage: { status: 'down' } } });
  });
});
