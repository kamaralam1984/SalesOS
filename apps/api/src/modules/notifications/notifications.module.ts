import { Global, Module } from '@nestjs/common';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';

/**
 * Notifications domain (Agent F). Global so any domain can inject `NotificationService` without importing this module
 * (contract in docs/platform-report.md section 1.1).
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationStreamService],
  exports: [NotificationService],
})
export class NotificationsModule {}
