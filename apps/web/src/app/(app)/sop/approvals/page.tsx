import * as React from 'react';
import { ApprovalsPage } from '@/features/sop/approvals-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ApprovalsPage />
    </React.Suspense>
  );
}
