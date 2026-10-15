import { Module } from '@nestjs/common';
import { ConversionWorker } from './conversion.worker';

@Module({
  providers: [ConversionWorker],
  exports: [ConversionWorker],
})
export class ConversionModule {}
