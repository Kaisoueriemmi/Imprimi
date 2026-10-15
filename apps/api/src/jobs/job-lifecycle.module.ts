import { Module } from '@nestjs/common';
import { JobFilesService } from './job-files.service';
import { JobStateService } from './job-state.service';

/** Status transitions and file deletion, shared by jobs, payments, conversion and expiry. */
@Module({
  providers: [JobStateService, JobFilesService],
  exports: [JobStateService, JobFilesService],
})
export class JobLifecycleModule {}
