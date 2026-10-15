import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { OfflinePaymentProvider } from './payment-provider';

/**
 * Coin machine at the kiosk (main method). The payment is created when the customer reserves
 * the machine and confirmed by CoinPaymentService once the inserted coins cover the amount.
 */
@Injectable()
export class CoinPaymentProvider extends OfflinePaymentProvider {
  readonly provider = PaymentProvider.COIN;
}

/** Cash at the counter, confirmed by an operator typing the pickup code (fallback). */
@Injectable()
export class CounterPaymentProvider extends OfflinePaymentProvider {
  readonly provider = PaymentProvider.COUNTER;
}

/** Demo mode: confirmed immediately. Refused unless PAYMENT_FREE_MODE=true (never in production). */
@Injectable()
export class FreePaymentProvider extends OfflinePaymentProvider {
  readonly provider = PaymentProvider.FREE;
}
