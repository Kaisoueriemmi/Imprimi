import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { ClientUpdatesGateway } from './client-updates.gateway';

@Module({
  imports: [SessionsModule],
  providers: [ClientUpdatesGateway],
})
export class ClientUpdatesModule {}
