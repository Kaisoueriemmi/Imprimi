import type { Payment, PaymentProvider } from '@prisma/client';
import { PaymentStatus } from '@prisma/client';
import type { PrismaTx } from '../../jobs/job-state.service';

/** A payment update reported by an online provider (Konnect, Flouci…). */
export interface WebhookPaymentUpdate {
  /** Provider-side reference, matched against `Payment.reference`. */
  reference: string;
  status: 'CONFIRMED' | 'FAILED';
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

/**
 * One way of paying. Offline methods (coins, counter, free) only record payments; online ones
 * will also create a remote checkout and authenticate the provider's webhook calls.
 */
export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;

  /** Records a new payment attempt for a job (and starts a remote checkout for online providers). */
  createPayment(tx: PrismaTx, input: { jobId: string; amountMillimes: number }): Promise<Payment>;

  /**
   * Authenticates a webhook call (signature, amount) and returns the update it carries.
   * Offline providers have no webhook and return null.
   */
  verifyWebhook(request: WebhookRequest): Promise<WebhookPaymentUpdate | null>;

  /** Marks the payment CONFIRMED. */
  confirm(
    tx: PrismaTx,
    paymentId: string,
    input?: { confirmedById?: string | null; reference?: string | null },
  ): Promise<Payment>;
}

/** Common behaviour of the providers that need no remote call. */
export abstract class OfflinePaymentProvider implements PaymentProviderAdapter {
  abstract readonly provider: PaymentProvider;

  createPayment(tx: PrismaTx, input: { jobId: string; amountMillimes: number }): Promise<Payment> {
    return tx.payment.create({
      data: { jobId: input.jobId, provider: this.provider, amountMillimes: input.amountMillimes },
    });
  }

  verifyWebhook(): Promise<WebhookPaymentUpdate | null> {
    return Promise.resolve(null);
  }

  confirm(
    tx: PrismaTx,
    paymentId: string,
    input: { confirmedById?: string | null; reference?: string | null } = {},
  ): Promise<Payment> {
    return tx.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedById: input.confirmedById ?? null,
        reference: input.reference ?? null,
      },
    });
  }
}
