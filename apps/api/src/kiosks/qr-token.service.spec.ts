import { JwtService } from '@nestjs/jwt';
import { ApiErrorCode, TIMINGS } from '@printbox/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../common/api-exception';
import type { AppConfigService } from '../config/env';
import { QrTokenService } from './qr-token.service';

const SECRET = 'q'.repeat(40);

function createService(secret = SECRET): QrTokenService {
  const values: Record<string, string> = {
    QR_TOKEN_SECRET: secret,
    PUBLIC_WEB_URL: 'https://print.example.tn',
  };
  const config = { get: (key: string) => values[key] } as unknown as AppConfigService;
  return new QrTokenService(new JwtService(), config);
}

async function expectRescan(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiException);
  expect((error as ApiException).body).toEqual({
    statusCode: 401,
    code: ApiErrorCode.QR_EXPIRED,
    message: 'Rescannez le QR sur la borne',
  });
}

describe('QrTokenService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a token encoded in the kiosk URL, valid 90 s', async () => {
    const service = createService();
    const before = Date.now();
    const issued = await service.issue('kiosk-1');

    const url = new URL(issued.url);
    expect(url.origin + url.pathname).toBe('https://print.example.tn/k/kiosk-1');
    expect(url.searchParams.get('t')).toBe(issued.token);
    const ttl = new Date(issued.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(TIMINGS.qrTokenTtlMs - 2000);
    expect(ttl).toBeLessThanOrEqual(TIMINGS.qrTokenTtlMs);
    expect(issued.refreshInMs).toBe(TIMINGS.qrRefreshIntervalMs);
  });

  it('verifies a fresh token and returns a unique nonce', async () => {
    const service = createService();
    const a = await service.verify((await service.issue('kiosk-1')).token, 'kiosk-1');
    const b = await service.verify((await service.issue('kiosk-1')).token, 'kiosk-1');
    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti);
  });

  it('rejects the token after 90 s (a photo of the QR stops working)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = createService();
    const { token } = await service.issue('kiosk-1');
    vi.advanceTimersByTime(TIMINGS.qrTokenTtlMs + 1000);
    await expectRescan(service.verify(token, 'kiosk-1'));
  });

  it('rejects a token issued for another kiosk', async () => {
    const service = createService();
    const { token } = await service.issue('kiosk-1');
    await expectRescan(service.verify(token, 'kiosk-2'));
  });

  it('rejects forged and malformed tokens', async () => {
    const forged = await createService('f'.repeat(40)).issue('kiosk-1');
    await expectRescan(createService().verify(forged.token, 'kiosk-1'));
    await expectRescan(createService().verify('not-a-jwt', 'kiosk-1'));
  });

  it('rejects a JWT signed with the right secret but another audience', async () => {
    const token = await new JwtService().signAsync(
      {},
      {
        secret: SECRET,
        audience: 'printbox:session',
        subject: 'kiosk-1',
        jwtid: 'x',
        expiresIn: 60,
      },
    );
    await expectRescan(createService().verify(token, 'kiosk-1'));
  });
});
