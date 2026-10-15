import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

/** Workforce / goals (45-day cycle). Owned by area B; see docs/workforce-report.md s2.4 and s3. */
@Module({ controllers: [GoalsController], providers: [GoalsService], exports: [GoalsService] })
export class GoalsModule {}
