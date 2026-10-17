import { identityPermissions } from './identity';
import { crmPermissions } from './crm';
import { revenuePermissions } from './revenue';
import { peoplePermissions } from './people';
import { cxPermissions } from './cx';
import { sopPermissions } from './sop';
import { collaborationPermissions } from './collaboration';
import { reportingPermissions } from './reporting';
import { notificationsPermissions } from './notifications';
import { filesPermissions } from './files';
import { integrationsPermissions } from './integrations';
import { aiPermissions } from './ai';
import { devicesPermissions } from './devices';
import { platformPermissions } from './platform';
import { workforcePermissions } from './workforce';
import { devpanelPermissions } from './devpanel';
import { homelayoutPermissions } from './homelayout';

/** One line per domain. A new domain adds its file above and one entry here. */
export const PERMISSION_SETS = [
  identityPermissions,
  crmPermissions,
  revenuePermissions,
  peoplePermissions,
  cxPermissions,
  sopPermissions,
  collaborationPermissions,
  reportingPermissions,
  notificationsPermissions,
  filesPermissions,
  integrationsPermissions,
  aiPermissions,
  devicesPermissions,
  platformPermissions,
  workforcePermissions,
  devpanelPermissions,
  homelayoutPermissions,
] as const;

export type { PermissionDef } from './define';
