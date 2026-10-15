import { RequirePermission } from '@/features/auth/require-permission';
import { ExecutiveDashboard } from '@/features/dashboard/executive-dashboard';

export default function Page() {
  return (
    <RequirePermission permission="dashboard:salesperson:view">
      <ExecutiveDashboard />
    </RequirePermission>
  );
}
