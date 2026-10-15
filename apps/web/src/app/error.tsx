'use client';
import { AccentLine, ErrorState } from '@salesos/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas p-4">
      <AccentLine tone="tricolor" className="max-w-40" />
      <ErrorState onRetry={reset} requestId={error.digest} />
    </div>
  );
}
