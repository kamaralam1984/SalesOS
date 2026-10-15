import * as React from 'react';
import { NewSopPage } from '@/features/sop/editor-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <NewSopPage />
    </React.Suspense>
  );
}
