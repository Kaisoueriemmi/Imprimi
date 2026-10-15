import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { KioskScreenState } from '@printbox/shared';
import { KioskDisplayGuard } from '../kiosks/kiosk-display.guard';
import { KioskScreenService } from './kiosk-screen.service';

@Controller('kiosks')
export class KioskScreenController {
  constructor(private readonly screen: KioskScreenService) {}

  /** Same state as the `kiosk:state` push; used when the socket is not connected yet. */
  @Get(':kioskId/screen')
  @Header('Cache-Control', 'no-store')
  @UseGuards(KioskDisplayGuard)
  state(@Param('kioskId') kioskId: string): Promise<KioskScreenState> {
    return this.screen.state(kioskId);
  }
}
