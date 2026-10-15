import { RequirePermission } from '@/features/auth/require-permission';
import { AdminHealth } from '@/features/dashboard/admin-health';

export default function Page() {
  return (
    <RequirePermission permission="dashboard:system-health:view">
      <AdminHealth />
    </RequirePermission>
  );
}
