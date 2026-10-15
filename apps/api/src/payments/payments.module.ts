import { Module } from '@nestjs/common';
import { JobLifecycleModule } from '../jobs/job-lifecycle.module';
import { SessionsModule } from '../sessions/sessions.module';
import { CoinPaymentController } from './coin-payment.controller';
import { CoinPaymentService } from './coin-payment.service';
import { CounterPaymentService } from './counter-payment.service';
import { PAYMENT_PROVIDER_CLASSES, PaymentProviders } from './payment-providers';
import { PaymentsService } from './payments.service';

@Module({
  imports: [JobLifecycleModule, SessionsModule],
  controllers: [CoinPaymentController],
  providers: [
    ...PAYMENT_PROVIDER_CLASSES,
    PaymentProviders,
    PaymentsService,
    CoinPaymentService,
    CounterPaymentService,
  ],
  exports: [PaymentProviders, PaymentsService, CoinPaymentService, CounterPaymentService],
})
export class PaymentsModule {}
