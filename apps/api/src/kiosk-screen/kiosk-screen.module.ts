import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { KiosksModule } from '../kiosks/kiosks.module';
import { KioskScreenController } from './kiosk-screen.controller';
import { KioskScreenGateway } from './kiosk-screen.gateway';
import { KioskScreenService } from './kiosk-screen.service';

@Module({
  imports: [KiosksModule, AgentsModule],
  controllers: [KioskScreenController],
  providers: [KioskScreenService, KioskScreenGateway],
})
export class KioskScreenModule {}
