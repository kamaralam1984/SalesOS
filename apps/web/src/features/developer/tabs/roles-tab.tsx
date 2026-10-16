'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, FormField, Panel, Select } from '@salesos/ui';
import { ROLE_KEYS, type RoleKey } from '@/lib/api/types';
import { ROLE_NAV_SCOPE, type GuideScope } from '../role-guide-access';
import { GROUP_LABEL, GUIDE_FLOWS, GUIDE_MODULES, GUIDE_ROLES } from '../role-guide-content';

const SCOPE_TONE: Record<GuideScope, 'gold' | 'blue' | 'neutral' | 'green'> = { org: 'gold', team: 'blue', own: 'neutral', summary: 'green' };

/** Role guide: per role, which pages are rolled out, at what scope, and how each works. Static content + generated access list. */
export function RolesTab() {
  const t = useTranslations('developer.guide');
  const ts = useTranslations('developer.access.scope');
  const tr = useTranslations('roles');
  const [role, setRole] = React.useState<RoleKey>('SALES_EXECUTIVE');
  const info = GUIDE_ROLES.find((r) => r.role === role);
  const access = React.useMemo(() => ROLE_NAV_SCOPE[role] ?? {}, [role]);

  // Pages in catalogue order, grouped. A child page is listed only when the role holds it; the group page itself is the section header.
  const groups = React.useMemo(() => {
    const out: Array<{ group: string; items: typeof GUIDE_MODULES }> = [];
    for (const mod of GUIDE_MODULES) {
      if (!access[mod.id]) continue;
      let g = out.find((x) => x.group === mod.group);
      if (!g) out.push((g = { group: mod.group, items: [] }));
      g.items.push(mod);
    }
    return out;
  }, [access]);
  const pageCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">{t('intro')} {t('english')}</p>

      <div className="max-w-xs">
        <FormField label={t('pickRole')}>
          <Select value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {ROLE_KEYS.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
          </Select>
        </FormField>
      </div>

      {info && (
        <Panel title={tr(role)}>
          <p className="text-sm text-ink">{info.summary}</p>
          <p className="mt-3 text-sm text-muted"><span className="font-medium text-ink">{t('landsOn')}:</span> <code className="rounded bg-ivory-100 px-1.5 py-0.5 text-xs">{info.lands}</code></p>
          <h3 className="mt-4 text-sm font-semibold text-ink">{t('limits')}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">{info.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </Panel>
      )}

      <section aria-label={t('pages')}>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold text-ink">{t('pages')}</h2>
          <span className="text-sm text-muted">{t('pagesCount', { count: pageCount })}</span>
        </div>
        <p className="mb-3 text-xs text-muted">{t('scopeHint')}</p>
        <div className="space-y-4">
          {groups.map((g) => (
            <Panel key={g.group} title={GROUP_LABEL[g.group] ?? g.group}>
              <ul className="divide-y divide-line">
                {g.items.map((mod) => {
                  const scope = access[mod.id]!;
                  return (
                    <li key={mod.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{mod.name}</span>
                        <Badge tone={SCOPE_TONE[scope]}>{ts(scope)}</Badge>
                        <Link href={mod.path} className="text-xs text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{t('open')} <code>{mod.path}</code></Link>
                      </div>
                      <p className="mt-1 text-sm text-muted">{mod.how}</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      </section>

      <section aria-label={t('flows')}>
        <h2 className="mb-3 text-base font-semibold text-ink">{t('flows')}</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {GUIDE_FLOWS.map((f) => (
            <Panel key={f.title} title={f.title}>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </Panel>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted">{t('generated')}</p>
    </div>
  );
}
