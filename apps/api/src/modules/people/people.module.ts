import { Module, type OnModuleInit } from '@nestjs/common';
import { AccessService } from '../../common/authz';
import { PrismaService } from '../../common/prisma';
import { FileAccessRegistry } from '../files/file-access.registry';
import { registerRecordFileResolvers } from '../files/entity-resolver';
import { CoachingController } from './coaching/coaching.controller';
import { CoachingService } from './coaching/coaching.service';
import { EngagementController } from './engagement/engagement.controller';
import { EngagementService } from './engagement/engagement.service';
import { HiringController } from './hiring/hiring.controller';
import { HiringService } from './hiring/hiring.service';
import { IncentivesController } from './incentives/incentives.controller';
import { IncentivesService } from './incentives/incentives.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { PerformanceController } from './performance/performance.controller';
import { PerformanceService } from './performance/performance.service';
import { PipController } from './pip/pip.controller';
import { PipService } from './pip/pip.service';
import { RecognitionController } from './recognition/recognition.controller';
import { RecognitionService } from './recognition/recognition.service';
import { ResourcesController } from './resources/resources.controller';
import { ResourcesService } from './resources/resources.service';
import { SuccessionController } from './succession/succession.controller';
import { SuccessionService } from './succession/succession.service';

/**
 * People domain (Phase 6): coaching, KPI/KRA, reviews, PIP, recognition, incentives, hiring, onboarding/probation,
 * succession, engagement pulse, skills library. Revenue/analytics phases may provide INCENTIVE_INPUT_PROVIDER.
 */
@Module({
  controllers: [CoachingController, PerformanceController, PipController, RecognitionController, IncentivesController, HiringController, OnboardingController, SuccessionController, EngagementController, ResourcesController],
  providers: [CoachingService, PerformanceService, PipService, RecognitionService, IncentivesService, HiringService, OnboardingService, SuccessionService, EngagementService, ResourcesService],
  exports: [IncentivesService, HiringService],
})
export class PeopleModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly files: FileAccessRegistry) {}

  onModuleInit() {
    // HR documents: visible only through the HR permission AND the employee's hierarchy scope; Admin holds none of them.
    registerRecordFileResolvers(this.files, this.access, {
      review: {
        view: 'reviews:view', attach: ['reviews:create'],
        load: async (id) => {
          const r = await this.prisma.performanceReview.findUnique({ where: { id }, select: { organizationId: true, employeeId: true, reviewerId: true } });
          return r ? { organizationId: r.organizationId, ownerId: r.employeeId, alsoUserIds: [r.reviewerId] } : null;
        },
      },
      candidate: {
        view: 'hiring:view', attach: ['hiring:manage'],
        load: async (id) => this.prisma.candidate.findUnique({ where: { id }, select: { organizationId: true } }).then((c) => (c ? { organizationId: c.organizationId, ownerId: null } : null)),
      },
      onboarding: {
        view: 'onboarding:view', attach: ['onboarding:manage'],
        load: async (id) => {
          const o = await this.prisma.onboardingPlan.findUnique({ where: { id }, select: { organizationId: true, employeeId: true } });
          return o ? { organizationId: o.organizationId, ownerId: o.employeeId } : null;
        },
      },
      pip: {
        view: 'pip:view', attach: ['pip:create', 'pip:update'],
        load: async (id) => {
          const p = await this.prisma.improvementPlan.findUnique({ where: { id }, select: { organizationId: true, employeeId: true } });
          return p ? { organizationId: p.organizationId, ownerId: p.employeeId } : null;
        },
      },
    });
  }
}
