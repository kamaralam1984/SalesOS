import * as React from 'react';
import { EditSopPage } from '@/features/sop/editor-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <EditSopPage />
    </React.Suspense>
  );
}
