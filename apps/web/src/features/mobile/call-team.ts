import { useAuth } from '@/features/auth/auth-provider';
import type { RoleKey } from '@/lib/api/types';

/**
 * Roles whose job is calling leads: Sales Executive (telecaller), Sales Manager and Sales Team Lead.
 * Only these see the call system on the mobile home (Calls Today, Follow-ups, call buttons, Add Follow-up).
 * This is UI scoping on top of the permissions; the API stays the authority for the data.
 */
export const CALL_TEAM_ROLES: readonly RoleKey[] = ['SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD'];

export const isCallTeam = (roles: readonly RoleKey[] | undefined): boolean => Boolean(roles?.some((r) => CALL_TEAM_ROLES.includes(r)));

export function useIsCallTeam(): boolean {
  const { user } = useAuth();
  return isCallTeam(user?.roles);
}
