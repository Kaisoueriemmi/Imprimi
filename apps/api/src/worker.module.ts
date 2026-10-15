import { Module } from '@nestjs/common';
import { ConversionModule } from './conversion/conversion.module';
import { CoreModule } from './core.module';

/** Conversion worker process: no HTTP server, only the queue consumer. */
@Module({
  imports: [CoreModule, ConversionModule],
})
export class WorkerModule {}
