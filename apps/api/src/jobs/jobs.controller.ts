import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CheckoutRequest,
  checkoutRequestSchema,
  JobView,
  PrintOptions,
  printOptionsSchema,
} from '@printbox/shared';
import type { Request } from 'express';
import { PrintSessionContext } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentSession, SessionGuard } from '../sessions/session.guard';
import { JobCheckoutService } from './job-checkout.service';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(SessionGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly checkouts: JobCheckoutService,
  ) {}

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

  /** Copies, colour, duplex, pages. Returns the job with its recomputed price. */
  @Patch(':jobId/options')
  updateOptions(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(printOptionsSchema)) options: PrintOptions,
  ): Promise<JobView> {
    return this.checkouts.updateOptions(session, jobId, options);
  }

  /** Validates the order: price frozen, pickup code issued, then pay with coins or at the counter. */
  @Post(':jobId/checkout')
  @HttpCode(200)
  checkout(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(checkoutRequestSchema)) body: CheckoutRequest,
  ): Promise<JobView> {
    return this.checkouts.checkout(session, jobId, body);
  }

  /** Cancels a job that is not paid yet; its files are deleted immediately. */
  @Delete(':jobId')
  cancel(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<JobView> {
    return this.checkouts.cancel(session, jobId);
  }
}
