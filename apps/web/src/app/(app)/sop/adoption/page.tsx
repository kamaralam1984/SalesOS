import * as React from 'react';
import { AdoptionPage } from '@/features/sop/adoption-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <AdoptionPage />
    </React.Suspense>
  );
}
