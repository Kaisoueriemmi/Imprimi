import { createHash } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { bearerToken } from './common/request-context';
import { CoreModule } from './core.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { KiosksModule } from './kiosks/kiosks.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PaymentsModule } from './payments/payments.module';
import { SessionsModule } from './sessions/sessions.module';

/**
 * Rate-limit bucket per bearer token (customer session or kiosk key), falling back to the IP.
 * A forged token only consumes its own bucket, and is rejected by the guards anyway.
 */
function sessionTracker(req: Record<string, unknown>): string {
  const request = req as unknown as Parameters<typeof bearerToken>[0] & { ip?: string };
  const token = bearerToken(request);
  if (!token) return `ip:${request.ip ?? 'unknown'}`;
  return `token:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'ip', ttl: 60_000, limit: 120 },
        { name: 'session', ttl: 60_000, limit: 120, getTracker: sessionTracker },
      ],
    }),
    HealthModule,
    KiosksModule,
    SessionsModule,
    JobsModule,
    PaymentsModule,
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
