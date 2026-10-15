import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { hashApiKey } from '../common/api-key';
import { unauthorized } from '../common/api-exception';
import { AppRequest, bearerToken } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Authenticates the kiosk screen with its display key (`Authorization: Bearer pbd_…`).
 * The key must belong to the kiosk named in the `:kioskId` route parameter.
 */
@Injectable()
export class KioskDisplayGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const key = bearerToken(req);
    const kioskId = req.params.kioskId;
    if (!key?.startsWith('pbd_') || !kioskId) throw unauthorized();

    const kiosk = await this.prisma.kiosk.findUnique({
      where: { displayKeyHash: hashApiKey(key) },
      select: { id: true },
    });
    if (!kiosk || kiosk.id !== kioskId) throw unauthorized();

    req.kiosk = { id: kiosk.id };
    return true;
  }
}
