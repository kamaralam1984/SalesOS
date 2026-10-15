import { Module, OnModuleInit } from '@nestjs/common';
import { AccessService } from '../../common/authz';
import { FileAccessRegistry } from '../files/file-access.registry';
import { registerRecordFileResolvers } from '../files/entity-resolver';
import { PrismaService } from '../../common/prisma';
import { CollectionsController } from './collections/collections.controller';
import { CollectionsService } from './collections/collections.service';
import { DealMoneyService } from './deals/deal-money.service';
import { DealsController } from './deals/deals.controller';
import { DealsService } from './deals/deals.service';
import { ForecastsController } from './forecasts/forecasts.controller';
import { ForecastsService } from './forecasts/forecasts.service';
import { IntelController } from './intel/intel.controller';
import { IntelService } from './intel/intel.service';
import { MetricsService } from './metrics.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingService } from './pricing/pricing.service';
import { RefundsController } from './refunds/refunds.controller';
import { RefundsService } from './refunds/refunds.service';
import { RevenueSupport, depsFactory, faultInjectorProvider } from './revenue.support';
import { ensureRevenueGuards } from './revenue-guards';
import { autoDdlEnabled } from '../../common/prisma/auto-ddl';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { TargetsController } from './targets/targets.controller';
import { TargetsService } from './targets/targets.service';

/**
 * Revenue domain (Phase 4): targets and breakdown, deals/pipeline, immutable sales records + adjustments, collections,
 * refunds, forecasts (immutable snapshots), pricing proposals, market intel, growth opportunities, strategy plans.
 * Pure calculations live in ./calc and are reused by Phase 5.
 */
@Module({
  controllers: [TargetsController, DealsController, CollectionsController, RefundsController, ForecastsController, PricingController, IntelController, SettingsController],
  providers: [RevenueSupport, depsFactory, faultInjectorProvider, MetricsService, DealMoneyService, TargetsService, DealsService, CollectionsService, RefundsService, ForecastsService, PricingService, IntelService, SettingsService],
  exports: [MetricsService, DealMoneyService],
})
export class RevenueModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly files: FileAccessRegistry) {}
  async onModuleInit() {
    if (autoDdlEnabled()) await ensureRevenueGuards(this.prisma);
    // Deal / payment (proofs) / refund documents inherit the record's owner-team scope. Summary-only roles (Student
    // Success on deals and refunds) never read money documents.
    registerRecordFileResolvers(this.files, this.access, {
      deal: {
        view: 'deals:view', attach: ['deals:update', 'deals:close'],
        load: async (id) => this.prisma.deal.findUnique({ where: { id }, select: { organizationId: true, ownerId: true, teamId: true } }),
      },
      payment: {
        view: 'collections:view', attach: ['collections:create', 'collections:verify'],
        load: async (id) => this.prisma.payment.findUnique({ where: { id }, select: { organizationId: true, ownerId: true, teamId: true } }),
      },
      refund: {
        view: 'refunds:view', attach: ['refunds:request', 'refunds:review', 'refunds:process'],
        load: async (id) => this.prisma.refund.findUnique({ where: { id }, select: { organizationId: true, ownerId: true, teamId: true } }),
      },
    });
  }
}
