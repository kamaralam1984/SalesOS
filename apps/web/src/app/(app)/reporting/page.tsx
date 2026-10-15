import { RequirePermission } from '@/features/auth/require-permission';
import { ReportingHome } from '@/features/reporting/reporting-home';

export default function Page() {
  return (
    <RequirePermission permission={['reports:view', 'kpi:view', 'kpi:definitions:view']}>
      <ReportingHome />
    </RequirePermission>
  );
}
