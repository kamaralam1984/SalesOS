import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AccentLine, Button, EmptyState } from '@salesos/ui';
import { SearchX } from 'lucide-react';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <main id="main" className="flex flex-col items-center gap-6">
        <AccentLine tone="tricolor" className="max-w-40" />
        <EmptyState
          icon={<SearchX />}
          title={t('title')}
          description={t('description')}
          action={
            <Button asChild>
              <Link href="/">{t('home')}</Link>
            </Button>
          }
        />
      </main>
    </div>
  );
}
