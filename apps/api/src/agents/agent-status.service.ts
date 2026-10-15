import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KioskStatus } from '@prisma/client';
import { AgentHeartbeat, TIMINGS } from '@printbox/shared';
import { DomainEvent, KioskChangedEvent } from '../events/domain-events';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async recordHeartbeat(kioskId: string, heartbeat: AgentHeartbeat): Promise<KioskStatus> {
    const status = kioskStatusFromHeartbeat(heartbeat);
    const previous = await this.prisma.kiosk.findUniqueOrThrow({
      where: { id: kioskId },
      select: { status: true, paperLevelHint: true },
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
    if (previous.status !== status || previous.paperLevelHint !== heartbeat.printer.paperLevel) {
      this.emitChanged(kioskId);
    }
    return status;
  }

  async markOffline(kioskId: string): Promise<void> {
    await this.prisma.kiosk.updateMany({
      where: { id: kioskId },
      data: { status: KioskStatus.OFFLINE },
    });
    this.logger.warn({ kioskId }, 'Kiosk agent disconnected');
    this.emitChanged(kioskId);
  }

  /** Kiosks silent for more than 2 minutes go OFFLINE (connection lost without a disconnect). */
  async markStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.kiosk.findMany({
      where: {
        status: { not: KioskStatus.OFFLINE },
        lastHeartbeatAt: { lt: new Date(now.getTime() - TIMINGS.kioskOfflineAfterMs) },
      },
      select: { id: true },
    });
    for (const { id } of stale) {
      await this.prisma.kiosk.update({ where: { id }, data: { status: KioskStatus.OFFLINE } });
      this.logger.warn({ kioskId: id }, 'Kiosk silent for 2 minutes, marked OFFLINE');
      this.emitChanged(id);
    }
    return stale.length;
  }

  /** Something the kiosk screen shows has changed (agent connection, printer state). */
  emitChanged(kioskId: string): void {
    this.events.emit(DomainEvent.KIOSK_CHANGED, { kioskId } satisfies KioskChangedEvent);
  }
}
