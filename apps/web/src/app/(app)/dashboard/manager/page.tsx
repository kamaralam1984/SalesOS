import { RequirePermission } from '@/features/auth/require-permission';
import { ManagerDashboard } from '@/features/dashboard/manager-dashboard';

export default function Page() {
  return (
    <RequirePermission permission="dashboard:manager:view">
      <ManagerDashboard />
    </RequirePermission>
  );
}
