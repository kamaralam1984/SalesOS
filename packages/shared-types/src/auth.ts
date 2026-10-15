import type { RoleKey } from './roles';
import type { EffectivePermission } from './permissions';

export interface AuthUserDto {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  isActive: boolean;
  managerId: string | null;
  roles: RoleKey[];
}

export interface ScopeSummary {
  organizationId: string;
  teamIds: string[];
  directReportCount: number;
  visibleUserCount: number;
  delegatedFromUserIds: string[];
}

export interface MeResponse {
  user: AuthUserDto;
  permissions: EffectivePermission[];
  scope: ScopeSummary;
  csrfToken: string;
  session: { expiresAt: string; idleExpiresAt: string };
}

export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_ID_HEADER = 'x-request-id';
