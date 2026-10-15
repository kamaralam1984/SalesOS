import { Module, OnModuleInit } from '@nestjs/common';
import { FileAccessRegistry } from '../files/file-access.registry';
import { CollaborationController } from './collaboration.controller';
import { InsightsService } from './insights/insights.service';
import { PlanLinksService } from './plan/plan-links.service';
import { XfTasksController } from './tasks/xf-tasks.controller';
import { XfTasksService } from './tasks/xf-tasks.service';

/**
 * Collaboration domain (Agent H): controlled cross-functional tasks / handoffs, campaign + webinar plan linkage and
 * minimum-data insight sharing. Department-scoped visibility lives in XfTasksService.
 */
@Module({
  controllers: [XfTasksController, CollaborationController],
  providers: [XfTasksService, PlanLinksService, InsightsService],
})
export class CollaborationModule implements OnModuleInit {
  constructor(private readonly files: FileAccessRegistry, private readonly tasks: XfTasksService) {}

  onModuleInit() {
    // task evidence files inherit the task's department-scoped visibility
    this.files.register('xf_task', async ({ user, entityId }) => this.tasks.canAccess(user, entityId));
  }
}
