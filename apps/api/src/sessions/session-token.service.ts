import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { sessionExpired } from '../common/api-exception';
import { PrintSessionContext } from '../common/request-context';
import { AppConfigService } from '../config/env';

const SESSION_AUDIENCE = 'printbox:session';

/** Bearer token held by the customer's phone for the duration of the session. */
@Injectable()
export class SessionTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    @Inject(ConfigService) config: AppConfigService,
  ) {
    this.secret = config.get('SESSION_TOKEN_SECRET', { infer: true });
  }

  issue(sessionId: string, kioskId: string, expiresAt: Date): Promise<string> {
    return this.jwt.signAsync(
      { kid: kioskId, exp: Math.floor(expiresAt.getTime() / 1000) },
      { secret: this.secret, algorithm: 'HS256', audience: SESSION_AUDIENCE, subject: sessionId },
    );
  }

  async verify(token: string): Promise<PrintSessionContext> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; kid?: string }>(token, {
        secret: this.secret,
        audience: SESSION_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub || !payload.kid) throw new Error('incomplete session token');
      return { id: payload.sub, kioskId: payload.kid };
    } catch {
      throw sessionExpired();
    }
  }
}
