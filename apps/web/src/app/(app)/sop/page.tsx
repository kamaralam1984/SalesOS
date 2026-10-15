import * as React from 'react';
import { LibraryPage } from '@/features/sop/library-page';

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <LibraryPage />
    </React.Suspense>
  );
}
