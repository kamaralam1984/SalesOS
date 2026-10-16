import { Module } from '@nestjs/common';
import { DevDashboardController } from './dashboard.controller';
import { DevDashboardService } from './dashboard.service';

/** Developer Panel / dashboard: consolidated health, 24h alerts, integrations and backup status (read-only). */
@Module({ controllers: [DevDashboardController], providers: [DevDashboardService] })
export class DevDashboardModule {}
