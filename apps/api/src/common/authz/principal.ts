import type { RoleKey, ScopeLevel } from '@salesos/shared-types';

/** The authenticated caller, rebuilt from the DB on every request (never trusted from the client). */
export interface Principal {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  managerId: string | null;
  roles: RoleKey[];
  /** permission key -> broadest scope across all held roles */
  permissions: ReadonlyMap<string, ScopeLevel>;
  sessionId: string;
  sessionFamilyId: string;
}

export interface AuthedRequest {
  id?: string;
  principal?: Principal;
  ip?: string;
}
