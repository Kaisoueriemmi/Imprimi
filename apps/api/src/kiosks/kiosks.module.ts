import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { KioskDisplayGuard } from './kiosk-display.guard';
import { KiosksController } from './kiosks.controller';
import { QrTokenService } from './qr-token.service';

@Module({
  // Secrets are passed per call: QR and session tokens use different keys.
  imports: [JwtModule.register({})],
  controllers: [KiosksController],
  providers: [QrTokenService, KioskDisplayGuard],
  exports: [QrTokenService],
})
export class KiosksModule {}
