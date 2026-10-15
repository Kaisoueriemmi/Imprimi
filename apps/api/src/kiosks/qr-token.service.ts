import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { QrTokenResponse, TIMINGS } from '@printbox/shared';
import { randomBytes } from 'node:crypto';
import { ApiException, qrExpired } from '../common/api-exception';
import { AppConfigService } from '../config/env';

const QR_AUDIENCE = 'printbox:qr';

/**
 * Short-lived signed token shown as a QR code on the kiosk screen. It proves the customer is in
 * front of the kiosk now: a photo of the QR stops working after 90 s.
 */
@Injectable()
export class QrTokenService {
  private readonly secret: string;
  private readonly webUrl: string;

  constructor(
    private readonly jwt: JwtService,
    @Inject(ConfigService) env: AppConfigService,
  ) {
    this.secret = env.get('QR_TOKEN_SECRET', { infer: true });
    this.webUrl = env.get('PUBLIC_WEB_URL', { infer: true });
  }

  async issue(kioskId: string): Promise<QrTokenResponse> {
    const token = await this.jwt.signAsync(
      {},
      {
        secret: this.secret,
        algorithm: 'HS256',
        audience: QR_AUDIENCE,
        subject: kioskId,
        jwtid: randomBytes(12).toString('base64url'),
        expiresIn: TIMINGS.qrTokenTtlMs / 1000,
      },
    );
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    const url = new URL(`/k/${encodeURIComponent(kioskId)}`, this.webUrl);
    url.searchParams.set('t', token);
    return {
      token,
      url: url.toString(),
      expiresAt: new Date(exp * 1000).toISOString(),
      refreshInMs: TIMINGS.qrRefreshIntervalMs,
    };
  }

  /** Returns the token id (nonce). Any failure — expired, forged, other kiosk — means "rescan". */
  async verify(token: string, kioskId: string): Promise<{ jti: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; jti?: string }>(token, {
        secret: this.secret,
        audience: QR_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (payload.sub !== kioskId || !payload.jti) throw qrExpired();
      return { jti: payload.jti };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw qrExpired();
    }
  }
}
