import { Injectable, Logger } from '@nestjs/common';
import { KioskStatus } from '@prisma/client';
import { AgentHeartbeat, TIMINGS } from '@printbox/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Windows printer states in which printing still works (the others put the kiosk in ERROR). */
const PRINTER_OK_STATES = new Set([
  'Normal',
  'Printing',
  'Processing',
  'Busy',
  'IoActive',
  'Waiting',
  'WarmingUp',
  'Initializing',
  'PowerSave',
  'TonerLow',
]);

export function kioskStatusFromHeartbeat(heartbeat: AgentHeartbeat): KioskStatus {
  const printerOk = heartbeat.printer.online && PRINTER_OK_STATES.has(heartbeat.printer.status);
  const coinsOk = heartbeat.coinDevice === null || heartbeat.coinDevice.connected;
  return printerOk && coinsOk ? KioskStatus.ONLINE : KioskStatus.ERROR;
}

/** Kiosk status from agent heartbeats and connections. */
@Injectable()
export class AgentStatusService {
  private readonly logger = new Logger(AgentStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordHeartbeat(kioskId: string, heartbeat: AgentHeartbeat): Promise<KioskStatus> {
    const status = kioskStatusFromHeartbeat(heartbeat);
    const previous = await this.prisma.kiosk.findUniqueOrThrow({
      where: { id: kioskId },
      select: { status: true },
    });
    await this.prisma.kiosk.update({
      where: { id: kioskId },
      data: {
        status,
        lastHeartbeatAt: new Date(),
        printerName: heartbeat.printer.name,
        paperLevelHint: heartbeat.printer.paperLevel,
      },
    });
    if (previous.status !== status) {
      this.logger.log({ kioskId, status, printer: heartbeat.printer.status }, 'Kiosk status');
    }
    return status;
  }

  async markOffline(kioskId: string): Promise<void> {
    await this.prisma.kiosk.updateMany({
      where: { id: kioskId },
      data: { status: KioskStatus.OFFLINE },
    });
    this.logger.warn({ kioskId }, 'Kiosk agent disconnected');
  }

  /** Kiosks silent for more than 2 minutes go OFFLINE (connection lost without a disconnect). */
  async markStale(now = new Date()): Promise<number> {
    const result = await this.prisma.kiosk.updateMany({
      where: {
        status: { not: KioskStatus.OFFLINE },
        lastHeartbeatAt: { lt: new Date(now.getTime() - TIMINGS.kioskOfflineAfterMs) },
      },
      data: { status: KioskStatus.OFFLINE },
    });
    return result.count;
  }
}
