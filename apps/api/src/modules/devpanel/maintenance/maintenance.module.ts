import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DevMaintenanceController, MaintenancePublicController } from './maintenance.controller';
import { MaintenanceInterceptor } from './maintenance.interceptor';
import { MaintenanceService } from './maintenance.service';

/** Developer Panel / maintenance mode: Redis-backed flag, fail-open, enforced by a global interceptor. */
@Module({
  controllers: [DevMaintenanceController, MaintenancePublicController],
  providers: [MaintenanceService, { provide: APP_INTERCEPTOR, useClass: MaintenanceInterceptor }],
  exports: [MaintenanceService],
})
export class DevMaintenanceModule {}
