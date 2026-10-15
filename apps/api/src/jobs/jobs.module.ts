import { Module } from '@nestjs/common';
import { ConversionModule } from '../conversion/conversion.module';
import { SessionsModule } from '../sessions/sessions.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [SessionsModule, ConversionModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
