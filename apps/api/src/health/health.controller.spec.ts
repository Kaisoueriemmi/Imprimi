import { Global, type INestApplication, Module } from '@nestjs/common';
import { PrismaHealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { HealthModule } from './health.module';

async function createApp(databaseUp: boolean): Promise<INestApplication> {
  const fakeIndicator = {
    pingCheck: async (key: string): Promise<HealthIndicatorResult> => ({
      [key]: { status: databaseUp ? 'up' : 'down' },
    }),
  };
  // Mirrors the real @Global() PrismaModule, with no database behind it.
  @Global()
  @Module({
    providers: [{ provide: PrismaService, useValue: {} }],
    exports: [PrismaService],
  })
  class FakePrismaModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [FakePrismaModule, HealthModule],
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

  it('returns 200 when the database is up', async () => {
    app = await createApp(true);
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });

  it('returns 503 when the database is down', async () => {
    app = await createApp(false);
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', error: { database: { status: 'down' } } });
  });
});
