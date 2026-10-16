'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Copy, Search, ShieldAlert, Terminal } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, ErrorState, FormField, Input, LoadingRegion, Panel, Select, Skeleton } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDevUsers } from '@/lib/api/hooks/devpanel';
import {
  useAccessFlags,
  useAccessMatrix,
  useAccessRunbook,
  useEffectivePermissions,
  type AccessPermission,
  type Scope,
} from '@/lib/api/hooks/devpanel-access';
import type { RoleKey } from '@/lib/api/types';
import { CountUp } from '@/components/motion';

const SCOPE_TONE: Record<Scope, 'gold' | 'blue' | 'neutral' | 'green'> = { org: 'gold', team: 'blue', own: 'neutral', summary: 'green' };

/** Scope chip: text label always present (never colour alone). */
function ScopeChip({ scope }: { scope: Scope }) {
  const t = useTranslations('developer.access.scope');
  return <Badge tone={SCOPE_TONE[scope] ?? 'neutral'}>{t(scope)}</Badge>;
}

export function AccessTab() {
  const t = useTranslations('developer.access');
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="space-y-6"
      initial={reduce ? false : 'hidden'}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.08 } } }}
    >
      {[<MatrixSection key="m" />, <FlagsSection key="f" />, <RunbookSection key="r" />].map((el) => (
        <motion.section
          key={el.key}
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
          aria-label={t(`sections.${el.key === 'm' ? 'matrix' : el.key === 'f' ? 'flags' : 'runbook'}`)}
        >
          {el}
        </motion.section>
      ))}
    </motion.div>
  );
}

/* ---------------------------------- matrix ---------------------------------- */

function MatrixSection() {
  const t = useTranslations('developer.access.matrix');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const apiErr = useApiErrorMessage();
  const reduce = useReducedMotion();
  const q = useAccessMatrix();
  const [search, setSearch] = React.useState('');
  const [domain, setDomain] = React.useState('');
  const [role, setRole] = React.useState('');
  const [sensitiveOnly, setSensitiveOnly] = React.useState(false);

  const rows = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.permissions ?? []).filter(
      (p) =>
        (!domain || p.domain === domain) &&
        (!role || p.grants[role as RoleKey]) &&
        (!sensitiveOnly || p.sensitive) &&
        (!s || p.key.toLowerCase().includes(s) || p.description.toLowerCase().includes(s)),
    );
  }, [q.data, search, domain, role, sensitiveOnly]);
  const shownRoles = (role ? [role] : q.data?.roles ?? []) as RoleKey[];

  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t('search')}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={t('searchPlaceholder')} />
        </FormField>
        <FormField label={t('domain')}>
          <Select value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">{t('allDomains')}</option>
            {(q.data?.domains ?? []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('role')}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('allRoles')}</option>
            {(q.data?.roles ?? []).map((r) => (
              <option key={r} value={r}>{tr(r)}</option>
            ))}
          </Select>
        </FormField>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={sensitiveOnly} onChange={(e) => setSensitiveOnly(e.target.checked)} className="size-4" />
          {t('sensitiveOnly')}
        </label>
      </div>

      {q.isPending && (
        <LoadingRegion label={tc('loading')} className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </LoadingRegion>
      )}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && (
        <>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {t('showing', { shown: rows.length, total: q.data.totalPermissions })}
          </p>
          <ul className="mb-4 flex flex-wrap gap-2" aria-label={t('totals')}>
            {q.data.roles.map((r) => (
              <li key={r}>
                <Badge tone={r === 'DEVELOPER' ? 'gold' : 'neutral'}>
                  {tr(r)}: <CountUp value={q.data.totals[r] ?? 0} />
                </Badge>
              </li>
            ))}
          </ul>
          {rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <>
              {/* desktop table */}
              <div className="hidden max-h-[32rem] overflow-auto rounded-lg border border-line md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <caption className="sr-only">{t('title')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 top-0 z-20 min-w-64 bg-surface p-2 font-semibold">{t('permission')}</th>
                      {shownRoles.map((r) => (
                        <th key={r} scope="col" className="sticky top-0 z-10 bg-surface p-2 font-semibold">{tr(r)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {rows.map((p) => (
                        <motion.tr
                          key={p.key}
                          layout={!reduce}
                          initial={reduce ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={reduce ? undefined : { opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className={`border-t border-line ${p.sensitive ? 'bg-gold-500/5' : ''}`}
                        >
                          <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left font-normal">
                            <PermissionLabel p={p} />
                          </th>
                          {shownRoles.map((r) => (
                            <td key={r} className="p-2">
                              {p.grants[r] ? <ScopeChip scope={p.grants[r] as Scope} /> : <span aria-label={t('none')} className="text-muted">—</span>}
                            </td>
                          ))}
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
              {/* mobile cards */}
              <ul className="space-y-2 md:hidden">
                {rows.map((p) => (
                  <motion.li
                    key={p.key}
                    layout={!reduce}
                    className={`rounded-lg border border-line p-3 ${p.sensitive ? 'bg-gold-500/5' : ''}`}
                  >
                    <PermissionLabel p={p} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {shownRoles.filter((r) => p.grants[r]).map((r) => (
                        <span key={r} className="inline-flex items-center gap-1 text-xs">
                          {tr(r)} <ScopeChip scope={p.grants[r] as Scope} />
                        </span>
                      ))}
                    </div>
                  </motion.li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <InspectUser />
    </Panel>
  );
}

function PermissionLabel({ p }: { p: AccessPermission }) {
  const t = useTranslations('developer.access.matrix');
  return (
    <span className="block">
      <span className="font-mono text-[11px]">{p.key}</span>
      {p.sensitive && (
        <Badge tone="gold" className="ml-2 align-middle">
          <ShieldAlert aria-hidden className="mr-1 inline size-3" />
          {t('sensitive')}
        </Badge>
      )}
      <span className="block text-muted">{p.description}</span>
    </span>
  );
}

function InspectUser() {
  const t = useTranslations('developer.access.inspect');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const users = useDevUsers(debounced ? { search: debounced } : {});
  const eff = useEffectivePermissions(picked);

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <p className="mb-3 text-xs text-muted">{t('hint')}</p>
      <FormField label={t('search')}>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={t('placeholder')} />
        </div>
      </FormField>
      {debounced && users.data && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('results')}>
          {users.data.slice(0, 8).map((u) => (
            <li key={u.id}>
              <Button size="sm" variant={picked === u.id ? 'primary' : 'secondary'} onClick={() => setPicked(u.id)}>
                {u.name} ({u.email})
              </Button>
            </li>
          ))}
          {users.data.length === 0 && <li className="text-sm text-muted">{t('noUsers')}</li>}
        </ul>
      )}
      {picked && eff.isPending && (
        <LoadingRegion label={tc('loading')} className="mt-3"><Skeleton className="h-16 w-full" /></LoadingRegion>
      )}
      {eff.isError && <ErrorState description={apiErr(eff.error).message} onRetry={() => void eff.refetch()} retryLabel={tc('retry')} />}
      {eff.data && (
        <div className="mt-3" data-testid="effective">
          <p className="mb-2 text-sm">
            <strong>{eff.data.user.name}</strong> · {eff.data.roles.map((r) => tr(r)).join(', ')} · {t('count', { count: eff.data.total })}
          </p>
          <ul className="grid max-h-80 gap-1 overflow-auto sm:grid-cols-2">
            {eff.data.permissions.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-1 text-xs">
                <span className="font-mono">{p.key}</span>
                <ScopeChip scope={p.scope} />
                {p.sensitive && <Badge tone="gold">{t('sensitive')}</Badge>}
                <span className="text-muted">{t('via', { roles: p.via.map((r) => tr(r)).join(', ') })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('whyNot')}</p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- flags ----------------------------------- */

const GOOD = new Set(['configured', 'enabled', 'on', 'redis', 'database-managed']);

function FlagsSection() {
  const t = useTranslations('developer.access.flags');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useAccessFlags();
  const label = (prefix: string, key: string) => (t.has(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : key);
  return (
    <Panel title={t('title')} description={t('description')}>
      {q.isPending && (
        <LoadingRegion label={tc('loading')} className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></LoadingRegion>
      )}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && (
        <>
          <p className="mb-3 text-sm text-muted">{t('environment', { env: q.data.environment })} · {t('noSecrets')}</p>
          {q.data.flags.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {q.data.flags.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="block text-sm font-medium">{label('names', f.key)}</span>
                    <span className="block text-xs text-muted">{label('groups', f.group)}</span>
                  </span>
                  <Badge tone={GOOD.has(f.status) ? 'green' : 'neutral'}>
                    <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${GOOD.has(f.status) ? 'bg-green-600' : 'bg-ink-muted'}`} />
                    {label('status', f.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------- runbook ---------------------------------- */

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('developer.access.runbook');
  const [done, setDone] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (!done && !failed) return;
    const id = setTimeout(() => { setDone(false); setFailed(false); }, 1800);
    return () => clearTimeout(id);
  }, [done, failed]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      setFailed(true);
    }
  };
  return (
    <Button size="sm" variant="secondary" onClick={() => void copy()} leadingIcon={
      <motion.span key={done ? 'ok' : 'copy'} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex">
        {done ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      </motion.span>
    }>
      <span aria-live="polite">{done ? t('copied') : failed ? t('copyFailed') : t('copy')}</span>
    </Button>
  );
}

function RunbookSection() {
  const t = useTranslations('developer.access.runbook');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useAccessRunbook();
  const [open, setOpen] = React.useState<string | null>('deploy');
  const reduce = useReducedMotion();
  return (
    <Panel title={t('title')} description={t('description')}>
      <Alert tone="warning" className="mb-4">
        <strong>{t('warnTitle')}</strong> {t('warnBody')}
      </Alert>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-16 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && q.data.sections.length === 0 && <EmptyState title={t('empty')} />}
      {q.data && (
        <div className="space-y-3">
          {q.data.sections.map((s, i) => {
            const isOpen = open === s.id;
            return (
              <motion.div
                key={s.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : i * 0.05 }}
                className="rounded-lg border border-line"
              >
                <h3>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-semibold"
                    aria-expanded={isOpen}
                    aria-controls={`rb-${s.id}`}
                    onClick={() => setOpen(isOpen ? null : s.id)}
                  >
                    <span className="inline-flex items-center gap-2"><Terminal aria-hidden className="size-4" />{t(`sections.${s.id}`)}</span>
                    <span className="text-xs font-normal text-muted">{s.source}</span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`rb-${s.id}`}
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <ol className="space-y-3 border-t border-line p-3">
                        {s.steps.map((st, n) => (
                          <li key={n} className="text-sm">
                            <p className="font-medium">{n + 1}. {st.title}</p>
                            {st.command && (
                              <div className="mt-1 flex flex-wrap items-start gap-2">
                                <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-sunken p-2 text-xs">{st.command}</code>
                                <CopyButton text={st.command} />
                              </div>
                            )}
                            {st.note && <p className="mt-1 text-xs text-muted">{st.note}</p>}
                          </li>
                        ))}
                      </ol>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
