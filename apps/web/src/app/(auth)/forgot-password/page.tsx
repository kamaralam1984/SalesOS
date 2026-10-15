import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ForgotPasswordPage } from '@/features/auth/password-pages';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordPage />
    </Suspense>
  );
}
