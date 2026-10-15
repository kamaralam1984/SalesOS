'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PhoneMissed, X } from 'lucide-react';
import { Button } from '@salesos/ui';
import { DispositionDialog } from './disposition-dialog';
import { PENDING_EVENT, clearPendingCall, readPendingCall, type PendingCall } from './pending-call';

/** Subscribes to pending-call changes and to the tab becoming visible again. */
export function usePendingCall() {
  const [pending, setPending] = React.useState<PendingCall | null>(null);
  const [returned, setReturned] = React.useState(0);
  React.useEffect(() => {
    const sync = () => setPending(readPendingCall());
    const back = () => {
      if (document.visibilityState === 'hidden') return;
      const p = readPendingCall();
      setPending(p);
      if (p) setReturned((n) => n + 1);
    };
    sync();
    window.addEventListener(PENDING_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener(PENDING_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return { pending, returned };
}

/**
 * After the user comes back from the dialer, ask for the mandatory disposition. A dismissible "Unlogged call"
 * banner stays on the workspace while the pending call exists.
 */
export function PendingCallPrompt() {
  const t = useTranslations('crm.pending');
  const { pending, returned } = usePendingCall();
  // snapshot of the call being logged: the sheet must outlive the pending marker (cleared on save)
  const [target, setTarget] = React.useState<PendingCall | null>(null);
  const [seen, setSeen] = React.useState(0);
  // derive-state-during-render: open the sheet once per return-to-tab event
  if (returned > seen && pending) {
    setSeen(returned);
    setTarget(pending);
  }
  if (!pending && !target) return null;
  return (
    <>
      {pending && <div role="status" data-testid="unlogged-call" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gold-300 bg-gold-50 px-3.5 py-2.5 text-sm">
        <span className="flex items-center gap-2 font-medium text-ink">
          <PhoneMissed className="size-4 text-gold-700" aria-hidden="true" />
          {t('banner', { name: pending.name })}
        </span>
        <span className="flex gap-2">
          <Button size="sm" onClick={() => setTarget(pending)}>{t('logNow')}</Button>
          <Button size="sm" variant="ghost" aria-label={t('dismiss')} onClick={() => clearPendingCall()}><X className="size-4" aria-hidden="true" /></Button>
        </span>
      </div>}
      {target && (
        <DispositionDialog
          open
          onOpenChange={(o) => {
            if (!o) setTarget(null);
          }}
          lead={{ id: target.leadId, fullName: target.name, phone: target.phone }}
          prompt={t('prompt', { name: target.name })}
        />
      )}
    </>
  );
}
