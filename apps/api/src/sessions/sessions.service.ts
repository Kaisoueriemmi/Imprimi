import { Injectable } from '@nestjs/common';
import {
  CreateSessionRequest,
  MAX_SESSIONS_PER_QR_TOKEN,
  SessionResponse,
  TIMINGS,
} from '@printbox/shared';
import { qrExpired } from '../common/api-exception';
import { QrTokenService } from '../kiosks/qr-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTokenService } from './session-token.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrTokens: QrTokenService,
    private readonly sessionTokens: SessionTokenService,
  ) {}

  /** Exchanges a fresh QR token for a customer session. */
  async create(input: CreateSessionRequest): Promise<SessionResponse> {
    const { jti } = await this.qrTokens.verify(input.token, input.kioskId);

    const kiosk = await this.prisma.kiosk.findUnique({
      where: { id: input.kioskId },
      select: { id: true, name: true, supportsColor: true, supportsDuplex: true },
    });
    if (!kiosk) throw qrExpired();

    // Soft limit (count then insert): enough to stop a leaked token from being farmed.
    const sessionsFromToken = await this.prisma.session.count({ where: { qrToken: jti } });
    if (sessionsFromToken >= MAX_SESSIONS_PER_QR_TOKEN) throw qrExpired();

    const expiresAt = new Date(Date.now() + TIMINGS.sessionTtlMs);
    const session = await this.prisma.session.create({
      data: { kioskId: kiosk.id, qrToken: jti, expiresAt },
      select: { id: true },
    });

    return {
      sessionId: session.id,
      sessionToken: await this.sessionTokens.issue(session.id, kiosk.id, expiresAt),
      expiresAt: expiresAt.toISOString(),
      kiosk,
    };
  }
}
