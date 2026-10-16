import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DevDashboardModule } from './dashboard/dashboard.module';
import { DevDiagnosticsModule } from './diagnostics/diagnostics.module';
import { DevSecurityModule } from './security/security.module';
import { DevAccessModule } from './access/access.module';
import { DevMaintenanceModule } from './maintenance/maintenance.module';
import { DevPanelController } from './devpanel.controller';
import { DevPanelService } from './devpanel.service';

/** Developer Panel: super-admin role/session control and server health. DEVELOPER role only. */
@Module({ imports: [IdentityModule, DevDashboardModule, DevDiagnosticsModule, DevSecurityModule, DevAccessModule, DevMaintenanceModule], controllers: [DevPanelController], providers: [DevPanelService] })
export class DevPanelModule {}
