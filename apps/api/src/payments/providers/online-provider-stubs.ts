import { Injectable, NotImplementedException } from '@nestjs/common';
import { Payment, PaymentProvider } from '@prisma/client';
import type { PrismaTx } from '../../jobs/job-state.service';
import type { PaymentProviderAdapter, WebhookPaymentUpdate } from './payment-provider';

/**
 * Konnect (konnect.network), Tunisian online payment: card, e-DINAR, wallet. Not implemented.
 *
 * Integration plan:
 * - `createPayment`: `POST /api/v2/payments/init-payment` with the amount in millimes, the
 *   order id (= Payment.id) and the webhook URL; store `paymentRef` in `Payment.reference`
 *   and return the `payUrl` for the phone to open.
 * - `verifyWebhook`: Konnect calls the webhook with `payment_ref` only; fetch
 *   `GET /api/v2/payments/:paymentRef` with the API key to get the real status and amount
 *   (never trust the callback alone), and check the amount matches.
 * - `confirm`: mark CONFIRMED with the reference; the job then goes PAID → QUEUED.
 * Secrets: KONNECT_API_KEY, KONNECT_WALLET_ID (env, validated in config/env.ts).
 */
@Injectable()
export class KonnectPaymentProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.KONNECT;

  createPayment(
    _tx: PrismaTx,
    _input: { jobId: string; amountMillimes: number },
  ): Promise<Payment> {
    throw new NotImplementedException('Konnect payments are not available yet');
  }

  verifyWebhook(): Promise<WebhookPaymentUpdate | null> {
    throw new NotImplementedException('Konnect payments are not available yet');
  }

  confirm(): Promise<Payment> {
    throw new NotImplementedException('Konnect payments are not available yet');
  }
}

/**
 * Flouci (flouci.com), Tunisian mobile wallet and card payments. Not implemented.
 *
 * Integration plan:
 * - `createPayment`: `POST /api/generate_payment` with app token/secret, amount in millimes,
 *   success/fail URLs and `developer_tracking_id` = Payment.id; store `payment_id` in
 *   `Payment.reference`, return the payment `link`.
 * - `verifyWebhook`: on return/callback, call `GET /api/verify_payment/:payment_id` and accept
 *   only `status = SUCCESS` with the expected amount.
 * - `confirm`: mark CONFIRMED with the reference.
 * Secrets: FLOUCI_APP_TOKEN, FLOUCI_APP_SECRET.
 */
@Injectable()
export class FlouciPaymentProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.FLOUCI;

  createPayment(
    _tx: PrismaTx,
    _input: { jobId: string; amountMillimes: number },
  ): Promise<Payment> {
    throw new NotImplementedException('Flouci payments are not available yet');
  }

  verifyWebhook(): Promise<WebhookPaymentUpdate | null> {
    throw new NotImplementedException('Flouci payments are not available yet');
  }

  confirm(): Promise<Payment> {
    throw new NotImplementedException('Flouci payments are not available yet');
  }
}
