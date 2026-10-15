import * as React from 'react';
import { GapsPage } from '@/features/sop/gaps-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <GapsPage />
    </React.Suspense>
  );
}
