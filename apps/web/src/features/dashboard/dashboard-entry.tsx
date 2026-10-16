'use client';
import { RoleRedirect } from '@/features/auth/role-redirect';
import { useAuth } from '@/features/auth/auth-provider';
import * as React from 'react';
import { DEVELOPER_HOME, landingPathFor } from '@/features/auth/roles';
import { WorkspaceHome } from './workspace-home';

const subscribeNoop = () => () => {};

/** `/dashboard`: redirects to the role dashboard, or shows the workspace home when the role has none. */
export function DashboardEntry() {
  const { user, permissions } = useAuth();
  // Developers land on their panel; `?workspace=1` keeps a way to the normal workspace home.
  const search = React.useSyncExternalStore(subscribeNoop, () => window.location.search, () => '');
  if (user && landingPathFor(user.roles, permissions) === DEVELOPER_HOME && new URLSearchParams(search).get('workspace') === '1') return <WorkspaceHome />;
  if (user && landingPathFor(user.roles, permissions) === '/dashboard') return <WorkspaceHome />;
  return <RoleRedirect />;
}
