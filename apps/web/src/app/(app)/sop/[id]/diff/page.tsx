import * as React from 'react';
import { DiffPage } from '@/features/sop/diff-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <DiffPage />
    </React.Suspense>
  );
}
