import { RequirePermission } from '@/features/auth/require-permission';
import { TeamLeadDashboard } from '@/features/dashboard/team-lead-dashboard';

export default function Page() {
  return (
    <RequirePermission permission="dashboard:team-lead:view">
      <TeamLeadDashboard />
    </RequirePermission>
  );
}
