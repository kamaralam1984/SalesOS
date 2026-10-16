/**
 * Wire types for the SalesOS API. These mirror `@salesos/shared-types` (owned by the backend agent);
 * they are kept local so the web app builds without the shared package being compiled first.
 * When the shared package is consumed directly, replace these with `import type {...} from '@salesos/shared-types'`.
 */
export const ROLE_KEYS = [
  'DEVELOPER',
  'FOUNDER_CEO',
  'SALES_TEAM_LEAD',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'ADMIN',
  'FINANCE',
  'HR',
  'MARKETING',
  'COMMUNITY',
  'OPERATIONS',
  'STUDENT_SUCCESS',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const PRIMARY_ROLE_KEYS = [
  'DEVELOPER',
  'FOUNDER_CEO',
  'SALES_TEAM_LEAD',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'ADMIN',
] as const;
export const SECONDARY_ROLE_KEYS = [
  'FINANCE',
  'HR',
  'MARKETING',
  'COMMUNITY',
  'OPERATIONS',
  'STUDENT_SUCCESS',
] as const;

export type ScopeLevel = 'own' | 'team' | 'org';

export interface EffectivePermission {
  key: string;
  scope: ScopeLevel;
}

export interface PaginationMeta {
  mode: 'cursor' | 'page';
  limit: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  page?: number;
  total?: number;
  totalPages?: number;
}

export interface ApiMeta {
  requestId?: string;
  warnings?: string[];
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  meta: ApiMeta;
  error: { code: string; message: string; details?: unknown } | null;
}

export interface AuthUser {
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
  user: AuthUser;
  permissions: EffectivePermission[];
  scope: ScopeSummary;
  csrfToken: string;
  session: { expiresAt: string; idleExpiresAt: string };
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  managerId: string | null;
  department?: string | null;
  hasPassword?: boolean;
  roles: RoleKey[];
  teamIds?: string[];
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface TeamMember {
  userId: string;
  name?: string;
  email?: string;
  membershipRole: 'LEAD' | 'MEMBER';
}

export interface Team {
  id: string;
  name: string;
  leadUserId?: string | null;
  memberCount?: number;
  members?: TeamMember[];
  createdAt?: string;
}

export interface OrgSettings {
  teamSoftLimit: number;
  businessTimezone: string;
  defaultCurrency: string;
  sessionIdleMinutes: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  ip?: string | null;
}

export interface PermissionCatalogueEntry {
  key: string;
  domain: string;
  description: string;
  sensitive: boolean;
  grants: Record<string, ScopeLevel>;
}
