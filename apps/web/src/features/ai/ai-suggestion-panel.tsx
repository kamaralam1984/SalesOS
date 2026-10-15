'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Check, Pencil, X } from 'lucide-react';
import { Alert, Badge, Button, Card, FormField, Textarea, useToast } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAiReview, useAiRun, useAiStatus, type AiRunResult, type AiSuggestionDto } from '@/lib/api/hooks/platform';
import { useAuth } from '@/features/auth/auth-provider';

type Feature = 'summarize' | 'extract' | 'draft-followup';

/** Output fields rendered/edited as text. Lists are one item per line. */
const FIELDS: Record<Feature, Array<{ key: string; list?: boolean }>> = {
  summarize: [{ key: 'summary' }, { key: 'keyPoints', list: true }],
  extract: [{ key: 'requirements', list: true }, { key: 'objections', list: true }, { key: 'interest' }, { key: 'budgetText' }, { key: 'nextSteps', list: true }],
  'draft-followup': [{ key: 'subject' }, { key: 'message' }, { key: 'reminders', list: true }],
};

function toText(o: Record<string, unknown>, key: string): string {
  if (key === 'budgetText') return ((o.budget as { text: string | null } | undefined)?.text ?? '') || '';
  const v = o[key];
  if (Array.isArray(v)) return v.join('\n');
  return typeof v === 'string' ? v : '';
}

function fromText(base: Record<string, unknown>, feature: Feature, vals: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const f of FIELDS[feature]) {
    const v = vals[f.key] ?? '';
    if (f.key === 'budgetText') out.budget = { mentioned: v.trim().length > 0, text: v.trim() || null };
    else if (f.list) out[f.key] = v.split('\n').map((s) => s.trim()).filter(Boolean);
    else out[f.key] = f.key === 'subject' ? (v.trim() || null) : v;
  }
  return out;
}

/**
 * Reusable AI suggestion panel (CRM embeds it next to notes/leads). Renders NOTHING when the Copilot flag is off or the
 * user lacks ai:use, so the CRM is unchanged without AI. Output is always labelled "AI suggestion", shows its sources,
 * is editable, and nothing is sent or saved anywhere until a person accepts it (and even then nothing is sent for them).
 */
export function AiSuggestionPanel({ feature, leadId, initialText = '', channel = 'EMAIL' }: { feature: Feature; leadId?: string; initialText?: string; channel?: string }) {
  const { can } = useAuth();
  const allowed = can('ai:use');
  const status = useAiStatus(allowed);
  if (!allowed || !status.data?.enabled) return null;
  return <PanelInner feature={feature} leadId={leadId} initialText={initialText} channel={channel} />;
}

function PanelInner({ feature, leadId, initialText, channel }: { feature: Feature; leadId?: string; initialText: string; channel: string }) {
  const t = useTranslations('platform.ai');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const run = useAiRun(feature);
  const review = useAiReview();
  const [text, setText] = React.useState(initialText);
  const [result, setResult] = React.useState<AiRunResult | null>(null);
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [reviewed, setReviewed] = React.useState<AiSuggestionDto['status'] | null>(null);

  async function generate() {
    setError(null);
    setResult(null);
    setReviewed(null);
    try {
      const r = await run.mutateAsync({ ...(leadId ? { leadId } : {}), ...(text.trim() ? { text } : {}), ...(feature === 'draft-followup' ? { channel } : {}) });
      setResult(r);
      if (r.suggestion) setVals(Object.fromEntries(FIELDS[feature].map((f) => [f.key, toText(r.suggestion!.output, f.key)])));
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  async function decide(action: 'ACCEPT' | 'EDIT' | 'REJECT') {
    if (!result?.suggestion) return;
    try {
      const s = result.suggestion;
      const r = await review.mutateAsync({ id: s.id, action, ...(action === 'EDIT' ? { editedOutput: fromText(s.output, feature, vals) } : {}) });
      setReviewed(r.status);
      toast({ tone: 'success', title: t(`reviewed.${r.status}`) });
    } catch (e) {
      toast({ tone: 'danger', title: apiErr(e).message });
    }
  }

  const s = result?.suggestion ?? null;
  return (
    <Card className="space-y-4" data-testid="ai-panel" aria-label={t(`title.${feature}`)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold"><Bot aria-hidden="true" className="size-5 text-gold-700" />{t(`title.${feature}`)}</h3>
        <Badge tone="gold">{t('badge')}</Badge>
      </div>
      <p className="text-[0.8125rem] text-muted">{t('intro')}</p>
      {!leadId && (
        <FormField label={t('notes')} hint={t('notesHint')}>
          <Textarea rows={5} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} />
        </FormField>
      )}
      <Button onClick={() => void generate()} loading={run.isPending} disabled={!leadId && !text.trim()}>{t('generate')}</Button>
      {error && <Alert tone="warning" title={t('unavailableTitle')}>{error} {t('continueManually')}</Alert>}
      {result?.insufficientData && <Alert tone="info" title={t('insufficientTitle')} live>{result.message}</Alert>}
      {s && (
        <div className="space-y-3 rounded-md border border-gold-300 bg-gold-50/40 p-3" data-testid="ai-output">
          <p className="text-[0.8125rem] font-medium text-gold-700">{result!.label}</p>
          <p className="text-xs text-muted">
            {t('sources', { origin: t(`origin.${s.sources.origin}`), count: s.sources.noteCount, redactions: s.sources.redactions })}
            {s.sources.period.from && <> · {t('period', { from: s.sources.period.from.slice(0, 10), to: (s.sources.period.to ?? '').slice(0, 10) })}</>}
            {' · '}{s.provider}/{s.model}
          </p>
          {s.sources.warnings.map((w) => <Alert key={w} tone="warning" live={false}>{w}</Alert>)}
          {FIELDS[feature].map((f) => (
            <FormField key={f.key} label={t(`field.${f.key}`)} hint={f.list ? t('onePerLine') : undefined}>
              <Textarea rows={f.list || f.key === 'message' || f.key === 'summary' ? 4 : 2} value={vals[f.key] ?? ''} disabled={reviewed !== null} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
            </FormField>
          ))}
          {reviewed ? (
            <Badge tone={reviewed === 'REJECTED' ? 'neutral' : 'green'}>{t(`reviewed.${reviewed}`)}</Badge>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" leadingIcon={<Check aria-hidden="true" className="size-4" />} loading={review.isPending} onClick={() => void decide('ACCEPT')}>{t('accept')}</Button>
              <Button size="sm" variant="secondary" leadingIcon={<Pencil aria-hidden="true" className="size-4" />} loading={review.isPending} onClick={() => void decide('EDIT')}>{t('saveEdit')}</Button>
              <Button size="sm" variant="ghost" leadingIcon={<X aria-hidden="true" className="size-4" />} loading={review.isPending} onClick={() => void decide('REJECT')}>{t('reject')}</Button>
            </div>
          )}
          <p className="text-xs text-muted">{t('neverSends')}</p>
        </div>
      )}
    </Card>
  );
}
