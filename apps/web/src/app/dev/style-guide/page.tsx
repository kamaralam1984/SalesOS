import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { StyleGuide } from '@/features/dev/style-guide';

export const metadata: Metadata = { title: 'Style guide', robots: { index: false } };

// Dev-only: 404 in production unless explicitly enabled (ENABLE_STYLE_GUIDE=true, used for CI a11y runs).
export const dynamic = 'force-dynamic';

export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_STYLE_GUIDE !== 'true')
    notFound();
  return <StyleGuide />;
}
