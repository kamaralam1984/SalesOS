import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginPage } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
