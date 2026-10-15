import { Injectable } from '@nestjs/common';
import { JobStatus, PaymentProvider } from '@prisma/client';
import { JobStateService, PrismaTx } from '../jobs/job-state.service';
import { PaymentProviders } from './payment-providers';

export interface CompletePaymentRequest {
  jobId: string;
  paymentId: string;
  provider: PaymentProvider;
  actor: string;
  confirmedById?: string | null;
}

/** What every payment method does once the money is there. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly providers: PaymentProviders,
    private readonly jobState: JobStateService,
  ) {}

  /** Payment CONFIRMED and job AWAITING_PAYMENT → PAID, in the caller's transaction. */
  async completePayment(tx: PrismaTx, request: CompletePaymentRequest): Promise<void> {
    await this.providers
      .get(request.provider)
      .confirm(tx, request.paymentId, { confirmedById: request.confirmedById ?? null });
    await this.jobState.transition(
      {
        jobId: request.jobId,
        from: [JobStatus.AWAITING_PAYMENT],
        to: JobStatus.PAID,
        data: { paidAt: new Date() },
        actor: request.actor,
        action: 'job.paid',
        metadata: { paymentId: request.paymentId, provider: request.provider },
      },
      tx,
    );
  }
}
