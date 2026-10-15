import { Module } from '@nestjs/common';
import { JobLifecycleModule } from '../jobs/job-lifecycle.module';
import { PaymentsModule } from '../payments/payments.module';
import { ExpiryService } from './expiry.service';

@Module({
  imports: [JobLifecycleModule, PaymentsModule],
  providers: [ExpiryService],
  exports: [ExpiryService],
})
export class MaintenanceModule {}
