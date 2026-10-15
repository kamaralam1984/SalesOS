import { RequirePermission } from '@/features/auth/require-permission';
import { FounderDashboard } from '@/features/dashboard/founder-dashboard';

export default function Page() {
  return (
    <RequirePermission permission="dashboard:ceo:view">
      <FounderDashboard />
    </RequirePermission>
  );
}
