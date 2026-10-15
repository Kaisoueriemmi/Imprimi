import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import {
  CoinPaymentProvider,
  CounterPaymentProvider,
  FreePaymentProvider,
} from './providers/offline-providers';
import { FlouciPaymentProvider, KonnectPaymentProvider } from './providers/online-provider-stubs';
import type { PaymentProviderAdapter } from './providers/payment-provider';

/** Looks up the adapter of a payment method. */
@Injectable()
export class PaymentProviders {
  private readonly byProvider: Map<PaymentProvider, PaymentProviderAdapter>;

  constructor(
    coin: CoinPaymentProvider,
    counter: CounterPaymentProvider,
    free: FreePaymentProvider,
    konnect: KonnectPaymentProvider,
    flouci: FlouciPaymentProvider,
  ) {
    this.byProvider = new Map(
      [coin, counter, free, konnect, flouci].map((adapter) => [adapter.provider, adapter]),
    );
  }

  get(provider: PaymentProvider): PaymentProviderAdapter {
    const adapter = this.byProvider.get(provider);
    if (!adapter) throw new Error(`No adapter for payment provider ${provider}`);
    return adapter;
  }
}

export const PAYMENT_PROVIDER_CLASSES = [
  CoinPaymentProvider,
  CounterPaymentProvider,
  FreePaymentProvider,
  KonnectPaymentProvider,
  FlouciPaymentProvider,
];
