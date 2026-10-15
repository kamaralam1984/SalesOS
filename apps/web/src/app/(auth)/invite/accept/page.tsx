import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InviteAcceptPage } from '@/features/auth/password-pages';

export const metadata: Metadata = { title: 'Accept invitation' };

export default function Page() {
  return (
    <Suspense>
      <InviteAcceptPage />
    </Suspense>
  );
}
