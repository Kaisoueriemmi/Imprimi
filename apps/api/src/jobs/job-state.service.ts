import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorCode, assertTransition, isActiveJobStatus, JobStatus } from '@printbox/shared';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';

export type PrismaTx = Prisma.TransactionClient;

export interface TransitionRequest {
  jobId: string;
  /** Statuses the job may currently be in; anything else is rejected. */
  from: readonly JobStatus[];
  to: JobStatus;
  data?: Omit<Prisma.PrintJobUpdateManyMutationInput, 'status'>;
  /** Audit trail: `session:<id>`, `admin:<id>`, `agent:<kioskId>`, `system`. */
  actor: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
}

export const invalidJobState = (): ApiException =>
  new ApiException(
    409,
    ApiErrorCode.INVALID_JOB_STATE,
    "Action impossible dans l'état actuel du document",
  );

/**
 * The only way to change a job's status. Applies the shared state machine, guards against
 * concurrent changes (compare-and-set on the current status), clears the active pickup code
 * when the job leaves the active statuses, and writes the audit log.
 */
@Injectable()
export class JobStateService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(request: TransitionRequest, tx: PrismaTx = this.prisma): Promise<void> {
    // A disallowed edge here is a programming error, not a user error.
    for (const from of request.from) assertTransition(from, request.to);

    const result = await tx.printJob.updateMany({
      where: { id: request.jobId, status: { in: [...request.from] } },
      data: {
        ...request.data,
        status: request.to,
        ...(isActiveJobStatus(request.to) ? {} : { activePickupCode: null }),
      },
    });
    if (result.count === 0) throw invalidJobState();

    await tx.auditLog.create({
      data: {
        actor: request.actor,
        action: request.action,
        entity: 'PrintJob',
        entityId: request.jobId,
        metadata: request.metadata ?? { to: request.to },
      },
    });
  }
}
