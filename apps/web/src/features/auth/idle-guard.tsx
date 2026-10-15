'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent } from '@salesos/ui';
import { useAuth } from './auth-provider';

const WARN_MS = 60_000;
const ACTIVITY_THROTTLE_MS = 60_000;

/**
 * Idle logout notice. The server owns the idle window (`session.idleExpiresAt`, extended by authenticated requests).
 * We keep it alive while the user is active, warn 60s before expiry, and sign out when it passes.
 */
export function IdleGuard() {
  const { me, refresh, logout } = useAuth();
  const t = useTranslations('session');
  const deadline = me ? Date.parse(me.session.idleExpiresAt) : null;
  const [now, setNow] = React.useState(() => Date.now());
  const lastTouch = React.useRef(0);
  React.useEffect(() => {
    lastTouch.current = Date.now();
  }, []);

  React.useEffect(() => {
    const onActivity = () => {
      const n = Date.now();
      if (n - lastTouch.current > ACTIVITY_THROTTLE_MS) {
        lastTouch.current = n;
        void refresh();
      }
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [refresh]);

  React.useEffect(() => {
    if (!deadline) return;
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [deadline]);

  const remaining = deadline ? deadline - now : Infinity;
  React.useEffect(() => {
    if (deadline && remaining <= 0) void logout('idle');
  }, [deadline, remaining, logout]);

  const open = Boolean(deadline) && remaining <= WARN_MS && remaining > 0;
  return (
    <Dialog open={open}>
      <DialogContent
        size="sm"
        title={t('idleTitle')}
        description={t('idleDescription', { seconds: Math.max(0, Math.ceil(remaining / 1000)) })}
        closeLabel={t('stay')}
        onInteractOutside={(e) => e.preventDefault()}
        footer={
          <>
            <Button variant="secondary" onClick={() => void logout('manual')}>
              {t('signOutNow')}
            </Button>
            <Button
              onClick={() => {
                lastTouch.current = Date.now();
                void refresh();
              }}
            >
              {t('stay')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('idleHelp')}</p>
      </DialogContent>
    </Dialog>
  );
}
