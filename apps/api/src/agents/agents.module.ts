import { Module } from '@nestjs/common';
import { JobLifecycleModule } from '../jobs/job-lifecycle.module';
import { PaymentsModule } from '../payments/payments.module';
import { AgentCoinsService } from './agent-coins.service';
import { AgentConnections } from './agent-connections';
import { AgentJobsService } from './agent-jobs.service';
import { AgentStatusService } from './agent-status.service';
import { AgentsGateway } from './agents.gateway';

@Module({
  imports: [JobLifecycleModule, PaymentsModule],
  providers: [
    AgentConnections,
    AgentJobsService,
    AgentCoinsService,
    AgentStatusService,
    AgentsGateway,
  ],
  exports: [AgentConnections, AgentStatusService, AgentJobsService],
})
export class AgentsModule {}
