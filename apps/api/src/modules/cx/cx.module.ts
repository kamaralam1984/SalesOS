import { Module, OnModuleInit } from '@nestjs/common';
import { AccessService } from '../../common/authz';
import { PrismaService } from '../../common/prisma';
import { FileAccessRegistry } from '../files/file-access.registry';
import { registerRecordFileResolvers } from '../files/entity-resolver';
import { AssignableUsersController } from './common/assignable.controller';
import { ComplaintsController } from './complaints/complaints.controller';
import { ComplaintsService } from './complaints/complaints.service';
import { ensureCxGuards } from './cx-guards';
import { autoDdlEnabled } from '../../common/prisma/auto-ddl';
import { ActionItemsService } from './founder/action-items.service';
import { FounderController } from './founder/founder.controller';
import { FounderReportsService } from './founder/founder-reports.service';
import { REPORT_DATA_PROVIDER } from './founder/report-data.provider';
import { ReportingModule } from '../reporting/reporting.module';
import { AnalyticsReportDataProvider } from '../reporting/founder/report-data.provider';
import { RisksService } from './founder/risks.service';
import { HandoverController } from './handover/handover.controller';
import { HandoverService } from './handover/handover.service';
import { EscalationsService } from './relationships/escalations.service';
import { RelationshipsController } from './relationships/relationships.controller';
import { RelationshipsService } from './relationships/relationships.service';
import { RefundsViewService } from './satisfaction/refunds-view.service';
import { SatisfactionController } from './satisfaction/satisfaction.controller';
import { SatisfactionService } from './satisfaction/satisfaction.service';
import { CxSettingsController } from './settings/cx-settings.controller';
import { CxSettingsService } from './settings/cx-settings.service';

/**
 * CX domain (Agent H, Phase 7): relationship history + escalations, complaints with SLA, satisfaction / enrolment experience,
 * refund tracking view, Student Success handover, Founder reporting (immutable snapshots, action items, risk register).
 * Contracts for other phases: REPORT_DATA_PROVIDER (Phase 5 binds real KPI values), docs/cx-report.md.
 */
@Module({
  imports: [ReportingModule],
  controllers: [AssignableUsersController, ComplaintsController, RelationshipsController, SatisfactionController, HandoverController, FounderController, CxSettingsController],
  providers: [
    ComplaintsService, RelationshipsService, EscalationsService, SatisfactionService, RefundsViewService, HandoverService,
    FounderReportsService, RisksService, ActionItemsService, CxSettingsService,
    // Phase 5: real KPI numbers (apps/api/src/modules/reporting). PendingPhase5ReportDataProvider remains in ./founder/report-data.provider.ts as the fallback.
    { provide: REPORT_DATA_PROVIDER, useExisting: AnalyticsReportDataProvider },
  ],
  exports: [REPORT_DATA_PROVIDER, HandoverService, ActionItemsService],
})
export class CxModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly files: FileAccessRegistry,
    private readonly handovers: HandoverService,
    private readonly actionItems: ActionItemsService,
  ) {}

  async onModuleInit() {
    // DB-level immutability for Founder report snapshots (idempotent)
    if (autoDdlEnabled()) await ensureCxGuards(this.prisma);
    // files attached to handovers / action items inherit the entity's visibility
    this.files.register('handover', async ({ user, entityId }) => this.handovers.canAccess(user, entityId));
    registerRecordFileResolvers(this.files, this.access, {
      complaint: {
        view: 'complaints:view', attach: ['complaints:create', 'complaints:update'],
        load: async (id) => this.prisma.complaint.findUnique({ where: { id }, select: { organizationId: true, ownerId: true, teamId: true } }),
      },
      founder_report: {
        view: 'founder-reports:view', attach: ['founder-reports:create'],
        load: async (id) => {
          const r = await this.prisma.founderReport.findUnique({ where: { id }, select: { organizationId: true, authorId: true } });
          return r ? { organizationId: r.organizationId, ownerId: r.authorId } : null;
        },
      },
    });
    this.files.register('action_item', async ({ user, entityId }) => this.actionItems.canAccess(user, entityId));
  }
}
