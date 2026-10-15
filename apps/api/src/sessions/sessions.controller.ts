import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CreateSessionRequest,
  createSessionRequestSchema,
  SessionResponse,
} from '@printbox/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Called by the web app when the customer opens the QR link. */
  @Post()
  @Throttle({ ip: { limit: 10, ttl: 60_000 } })
  create(
    @Body(new ZodValidationPipe(createSessionRequestSchema)) body: CreateSessionRequest,
  ): Promise<SessionResponse> {
    return this.sessions.create(body);
  }
}
