import * as React from 'react';
import { ReaderPage } from '@/features/sop/reader-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ReaderPage />
    </React.Suspense>
  );
}
