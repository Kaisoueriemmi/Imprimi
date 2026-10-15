import { Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CoinSessionView } from '@printbox/shared';
import { PrintSessionContext } from '../common/request-context';
import { CurrentSession, SessionGuard } from '../sessions/session.guard';
import { CoinPaymentService } from './coin-payment.service';

/** The customer's phone drives the coin machine reservation; the agent reports the coins. */
@Controller('jobs/:jobId/coin-payment')
@UseGuards(SessionGuard)
export class CoinPaymentController {
  constructor(private readonly coins: CoinPaymentService) {}

  /** Reserve the coin machine (409 KIOSK_BUSY when another customer is paying). */
  @Post()
  @HttpCode(200)
  start(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<CoinSessionView> {
    return this.coins.start(session, jobId);
  }

  @Get()
  get(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<CoinSessionView> {
    return this.coins.get(session, jobId);
  }

  /** Give up paying with coins; inserted coins are returned by the machine. */
  @Delete()
  @HttpCode(204)
  cancel(
    @CurrentSession() session: PrintSessionContext,
    @Param('jobId') jobId: string,
  ): Promise<void> {
    return this.coins.cancel(session, jobId);
  }
}
