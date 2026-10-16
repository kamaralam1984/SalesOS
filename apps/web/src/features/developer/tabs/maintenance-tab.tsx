'use client';

import * as React from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { useFormatter, useTranslations } from 'next-intl';
import { Power, Wrench } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, ErrorState, FormField, Input, LoadingRegion, Panel, Skeleton, Textarea, useToast } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useMaintenance, useEnableMaintenance, useDisableMaintenance } from '@/lib/api/hooks/devpanel-maintenance';

function PulseDot({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-flex size-4 items-center justify-center" aria-hidden="true">
      {on && !reduce && (
        <motion.span className="absolute inset-0 rounded-full bg-red-500/40" animate={{ scale: [1, 1.9], opacity: [0.6, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />
      )}
      <span className={`relative size-3 rounded-full ${on ? 'bg-red-600' : 'bg-emerald-600'}`} />
    </span>
  );
}

export function MaintenanceTab() {
  const t = useTranslations('developer.maintenance');
  const tc = useTranslations('common');
  const fmt = useFormatter();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const q = useMaintenance();
  const enable = useEnableMaintenance();
  const disable = useDisableMaintenance();
  const [msgDraft, setMessage] = React.useState<string | null>(null);
  const [etaDraft, setEta] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'on' | 'off' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const data = q.data;
  const on = Boolean(data?.enabled);
  const message = msgDraft ?? (data?.enabled ? data.message ?? '' : '');
  const eta = etaDraft ?? (data?.enabled && data.eta ? toLocalInput(data.eta) : '');

  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const msgOk = message.trim().length >= 3 && message.trim().length <= 300;
  const etaDate = eta ? new Date(eta) : null;
  const [etaPast, setEtaPast] = React.useState(false);
  const canSubmit = msgOk && !etaPast;

  async function doEnable() {
    setError(null);
    try {
      await enable.mutateAsync({ message: message.trim(), ...(etaDate ? { eta: etaDate.toISOString() } : {}) });
      toast({ tone: 'success', title: t(on ? 'updatedToast' : 'enabledToast') });
      setConfirm(null);
      setTouched(false);
      setMessage(null);
      setEta(null);
    } catch (e) {
      setConfirm(null);
      setError(apiErr(e).message);
    }
  }
  async function doDisable() {
    setError(null);
    try {
      await disable.mutateAsync();
      toast({ tone: 'success', title: t('disabledToast') });
      setMessage(null);
      setEta(null);
      setTouched(false);
      setConfirm(null);
    } catch (e) {
      setConfirm(null);
      setError(apiErr(e).message);
    }
  }

  if (q.isLoading) return <LoadingRegion label={tc('loading')}><Skeleton className="h-40 w-full" /></LoadingRegion>;
  if (q.isError) return <ErrorState title={t('loadError')} description={apiErr(q.error).message} retryLabel={tc('retry')} onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-4">
      <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.28 }}>
        <Panel title={t('tabTitle')} description={t('tabDescription')}>
          <div data-testid="maintenance-status" className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${on ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <div className="flex items-start gap-3">
              <PulseDot on={on} />
              <div>
                <p className="text-lg font-semibold text-ink">{on ? t('statusOn') : t('statusOff')}</p>
                <p className="text-sm text-ink-muted">{on ? t('onDetail') : t('offDetail')}</p>
                {on && data?.enabledAt && (
                  <p className="mt-1 text-sm text-ink-muted">
                    {data.enabledBy ? t('enabledBy', { name: data.enabledBy.name }) : t('enabledByUnknown', { when: when(data.enabledAt) })}
                    {data.enabledBy ? ` ${t('enabledSince', { when: when(data.enabledAt) })}` : ''}
                  </p>
                )}
                {on && <p className="text-sm text-ink-muted">{data?.eta ? t('eta', { when: when(data.eta) }) : t('noEta')}</p>}
              </div>
            </div>
            <Badge tone={on ? 'red' : 'green'}>{on ? t('statusOn') : t('statusOff')}</Badge>
          </div>
        </Panel>
      </motion.div>

      <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : 0.08 }}>
        <Panel title={on ? t('formTitleUpdate') : t('formTitle')}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!canSubmit) return; if (on) void doEnable(); else setConfirm('on'); }}>
            <AnimatePresence>
              {error && (
                <motion.div initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Alert tone="danger">{error}</Alert>
                </motion.div>
              )}
            </AnimatePresence>
            <FormField label={t('messageLabel')} hint={t('messageHint')} error={touched && !msgOk ? t('messageShort') : undefined}>
              <Textarea value={message} maxLength={300} rows={3} placeholder={t('messagePlaceholder')} onChange={(e) => { setMessage(e.target.value); setTouched(true); }} />
            </FormField>
            <FormField label={t('etaLabel')} hint={t('etaHint')} error={etaPast ? t('etaPast') : undefined} className="sm:max-w-xs">
              <Input type="datetime-local" value={eta} onChange={(e) => { setEta(e.target.value); setEtaPast(Boolean(e.target.value) && new Date(e.target.value).getTime() <= Date.now()); setTouched(true); }} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" leadingIcon={<Wrench className="size-4" />} loading={enable.isPending} loadingLabel={tc('saving')} disabled={touched && !canSubmit}>
                {on ? t('update') : t('enable')}
              </Button>
              {on && (
                <Button type="button" variant="secondary" leadingIcon={<Power className="size-4" />} onClick={() => setConfirm('off')}>
                  {t('disable')}
                </Button>
              )}
            </div>
            <p className="text-xs text-ink-muted">{t('failOpenNote')}</p>
          </form>
        </Panel>
      </motion.div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent
            size="md"
            title={confirm === 'on' ? t('confirmTitle') : t('confirmDisableTitle')}
            description={confirm === 'on' ? t('confirmBody') : t('confirmDisableBody')}
            closeLabel={tc('close')}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirm(null)}>{tc('cancel')}</Button>
                {confirm === 'on' ? (
                  <Button variant="danger" onClick={() => void doEnable()} loading={enable.isPending} loadingLabel={tc('saving')}>{t('confirmAction')}</Button>
                ) : (
                  <Button onClick={() => void doDisable()} loading={disable.isPending} loadingLabel={tc('saving')}>{t('confirmDisableAction')}</Button>
                )}
              </>
            }
          >
            {confirm === 'on' ? <Alert tone="warning">{message.trim()}</Alert> : null}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

/** ISO -> value for <input type="datetime-local"> in the browser's local zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
