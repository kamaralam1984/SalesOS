import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetPasswordPage } from '@/features/auth/password-pages';

export const metadata: Metadata = { title: 'Reset password' };

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
