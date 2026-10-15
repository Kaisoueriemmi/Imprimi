import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { KiosksModule } from '../kiosks/kiosks.module';
import { SessionTokenService } from './session-token.service';
import { SessionGuard } from './session.guard';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [JwtModule.register({}), KiosksModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionTokenService, SessionGuard],
  // Modules using @UseGuards(SessionGuard) need its dependencies in their injector.
  exports: [SessionTokenService, SessionGuard],
})
export class SessionsModule {}
