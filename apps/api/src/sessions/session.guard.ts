import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { sessionExpired } from '../common/api-exception';
import { AppRequest, bearerToken, PrintSessionContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTokenService } from './session-token.service';

/** Requires a valid, unexpired customer session (`Authorization: Bearer <sessionToken>`). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly tokens: SessionTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const token = bearerToken(req);
    if (!token) throw sessionExpired();

    const claims = await this.tokens.verify(token);
    const session = await this.prisma.session.findUnique({
      where: { id: claims.id },
      select: { id: true, kioskId: true, expiresAt: true },
    });
    if (!session || session.kioskId !== claims.kioskId || session.expiresAt <= new Date()) {
      throw sessionExpired();
    }
    req.printSession = { id: session.id, kioskId: session.kioskId };
    return true;
  }
}

/** The session resolved by SessionGuard. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PrintSessionContext => {
    const session = context.switchToHttp().getRequest<AppRequest>().printSession;
    if (!session) throw sessionExpired();
    return session;
  },
);
