import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { QrTokenResponse } from '@printbox/shared';
import { KioskDisplayGuard } from './kiosk-display.guard';
import { QrTokenService } from './qr-token.service';

@Controller('kiosks')
export class KiosksController {
  constructor(private readonly qrTokens: QrTokenService) {}

  /** Called by the kiosk screen every 60 s to refresh the QR code. */
  @Post(':kioskId/qr-token')
  @HttpCode(200)
  @UseGuards(KioskDisplayGuard)
  issueQrToken(@Param('kioskId') kioskId: string): Promise<QrTokenResponse> {
    return this.qrTokens.issue(kioskId);
  }
}
