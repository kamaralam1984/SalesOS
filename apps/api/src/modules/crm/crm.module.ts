import { Module, type OnModuleInit } from '@nestjs/common';
import { AccessService } from '../../common/authz';
import { PrismaService } from '../../common/prisma';
import { FileAccessRegistry } from '../files/file-access.registry';
import { registerRecordFileResolvers } from '../files/entity-resolver';
import { CrmContextRegistry } from '../ai/crm-context';
import { CallEventPortRegistry } from '../integrations/call-event-port';
import { CrmAiContextProvider } from './integration/crm-context.provider';
import { ProviderCallLogPort } from './integration/provider-call-log.port';
import { CallsService } from './calls/calls.service';
import { ConfigController } from './config/config.controller';
import { ConfigService } from './config/config.service';
import { CRM_DEPS, CrmSupport, crmDepsFactory, faultInjectorProvider } from './crm.support';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ImportsService } from './imports/imports.service';
import { DuplicatesService } from './leads/duplicates.service';
import { LeadsController, LeadsStaticController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { QueuesService } from './queues/queues.service';
import { DlqController } from './stream/dlq.controller';
import { StreamController } from './stream/stream.controller';
import { StreamService } from './stream/stream.service';
import { ReassignmentQueueController, TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';

/**
 * CRM core (Phase 3): leads, calls, tasks, follow-up engine, queues, imports, events, configuration, live updates.
 * Controller order matters: LeadsStaticController (/leads/workspace, /leads/import, ...) MUST precede LeadsController (/leads/:id).
 */
@Module({
  controllers: [LeadsStaticController, LeadsController, TasksController, ReassignmentQueueController, ConfigController, EventsController, StreamController, DlqController],
  providers: [crmDepsFactory, faultInjectorProvider, CrmSupport, LeadsService, DuplicatesService, CallsService, TasksService, ImportsService, QueuesService, ConfigService, EventsService, StreamService, CrmAiContextProvider],
  exports: [CRM_DEPS, CrmSupport, LeadsService],
})
export class CrmModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly files: FileAccessRegistry,
    private readonly aiContext: CrmContextRegistry,
    private readonly callEvents: CallEventPortRegistry,
    private readonly aiProvider: CrmAiContextProvider,
  ) {}

  onModuleInit() {
    this.aiContext.register(this.aiProvider);
    this.callEvents.register(new ProviderCallLogPort(this.callEvents.current(), this.prisma));
    // Files attached to a lead inherit the lead's visibility (org / team / own); attaching needs leads:update on it.
    registerRecordFileResolvers(this.files, this.access, {
      lead: {
        view: 'leads:view',
        attach: ['leads:update'],
        load: async (id) => {
          const l = await this.prisma.lead.findUnique({ where: { id }, select: { organizationId: true, assignedToId: true, teamId: true, mergedIntoId: true } });
          return l ? { organizationId: l.organizationId, ownerId: l.assignedToId, teamId: l.teamId } : null;
        },
      },
    });
  }
}
