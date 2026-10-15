'use client';
import { RoleRedirect } from '@/features/auth/role-redirect';
import { useAuth } from '@/features/auth/auth-provider';
import { landingPathFor } from '@/features/auth/roles';
import { WorkspaceHome } from './workspace-home';

/** `/dashboard`: redirects to the role dashboard, or shows the workspace home when the role has none. */
export function DashboardEntry() {
  const { user, permissions } = useAuth();
  if (user && landingPathFor(user.roles, permissions) === '/dashboard') return <WorkspaceHome />;
  return <RoleRedirect />;
}
