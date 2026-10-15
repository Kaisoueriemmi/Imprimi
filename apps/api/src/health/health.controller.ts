import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  UseFilters,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Keeps terminus' detailed 503 body instead of the generic API error format. */
@Catch(HttpException)
class HealthResponseFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}

@Controller('health')
@SkipThrottle({ ip: true, session: true })
@UseFilters(HealthResponseFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** 200 when every dependency answers, 503 otherwise. Used by Docker and the reverse proxy. */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma, { timeout: 2000 }),
      () => this.checkStorage(),
    ]);
  }

  private async checkStorage(): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check('storage');
    try {
      await this.storage.ping();
      return indicator.up();
    } catch {
      return indicator.down();
    }
  }
}
