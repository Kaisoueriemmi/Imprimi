import { Module } from '@nestjs/common';
import { JobLifecycleModule } from '../jobs/job-lifecycle.module';
import { PricingModule } from '../pricing/pricing.module';
import { ConversionWorker } from './conversion.worker';

@Module({
  imports: [JobLifecycleModule, PricingModule],
  providers: [ConversionWorker],
  exports: [ConversionWorker],
})
export class ConversionModule {}
