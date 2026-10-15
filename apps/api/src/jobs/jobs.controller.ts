import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JobView } from '@printbox/shared';
import type { Request } from 'express';
import { PrintSessionContext } from '../common/request-context';
import { CurrentSession, SessionGuard } from '../sessions/session.guard';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(SessionGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Multipart upload, single field `file`. Conversion runs in the background. */
  @Post()
  @HttpCode(201)
  @Throttle({ ip: { limit: 30, ttl: 600_000 }, session: { limit: 15, ttl: 600_000 } })
  upload(@CurrentSession() session: PrintSessionContext, @Req() req: Request): Promise<JobView> {
    return this.jobs.createFromUpload(session, req);
  }

  @Get(':jobId')
  get(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<JobView> {
    return this.jobs.getView(session, jobId);
  }

  @Get(':jobId/thumbnail')
  @Header('Cache-Control', 'private, max-age=300')
  async thumbnail(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<StreamableFile> {
    return new StreamableFile(await this.jobs.thumbnail(session, jobId), { type: 'image/webp' });
  }
}
