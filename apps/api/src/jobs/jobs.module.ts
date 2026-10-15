import { Module } from '@nestjs/common';
import { ConversionModule } from '../conversion/conversion.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { SessionsModule } from '../sessions/sessions.module';
import { JobCheckoutService } from './job-checkout.service';
import { JobLifecycleModule } from './job-lifecycle.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [SessionsModule, ConversionModule, JobLifecycleModule, PricingModule, PaymentsModule],
  controllers: [JobsController],
  providers: [JobsService, JobCheckoutService],
})
export class JobsModule {}
