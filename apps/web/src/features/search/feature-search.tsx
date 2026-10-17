'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Search } from 'lucide-react';
import { Dialog, DialogContent, Tooltip } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { NAV_DOMAINS } from '@/nav/registry';
import type { NavItem } from '@/nav/types';
import { FEATURES } from './feature-catalogue';
import { searchEntries, type SearchEntry } from './search-logic';

type Can = (permission: string | string[] | null, minScope?: NavItem['minScope']) => boolean;
interface Entry extends SearchEntry { permission: string | string[] | null; minScope?: NavItem['minScope'] }

/** Every nav item and sub-item with the same permission rule the sidebar uses. */
function navPermissions(): Map<string, Pick<NavItem, 'permission' | 'minScope'>> {
  const m = new Map<string, Pick<NavItem, 'permission' | 'minScope'>>();
  for (const d of NAV_DOMAINS) for (const i of d.items) {
    if (!m.has(i.href)) m.set(i.href, { permission: i.permission, minScope: i.minScope });
    for (const c of i.children ?? []) if (!m.has(c.href)) m.set(c.href, { permission: c.permission, minScope: c.minScope });
  }
  return m;
}

/** The entries this person may open: curated features first, then every page in the menu. Pure given the translators. */
export function buildEntries(can: Can, tNav: (k: string) => string, tFeat: (k: string) => string, tSection: (k: string) => string): Entry[] {
  const perms = navPermissions();
  const out: Entry[] = [];
  for (const f of FEATURES) {
    const rule = perms.get(f.href);
    out.push({ id: `feature.${f.id}`, href: f.href, title: tFeat(`${f.id}.title`), description: tFeat(`${f.id}.description`), section: tSection(f.section), keywords: f.keywords, permission: rule?.permission ?? null, minScope: rule?.minScope });
  }
  for (const d of NAV_DOMAINS) for (const i of d.items) {
    out.push({ id: `nav.${i.id}`, href: i.href, title: tNav(i.labelKey), section: d.sectionKey, keywords: i.href.replace(/[/-]+/g, ' '), permission: i.permission, minScope: i.minScope });
    for (const c of i.children ?? []) out.push({ id: `nav.${c.id}`, href: c.href, title: tNav(c.labelKey), section: tNav(i.labelKey), keywords: c.href.replace(/[/-]+/g, ' '), permission: c.permission, minScope: c.minScope });
  }
  return out.filter((e) => can(e.permission, e.minScope));
}

/** Search button (top bar) and the Ctrl/Cmd+K palette: type what you want and jump to the page or section that has it. */
export function FeatureSearch() {
  const t = useTranslations('search');
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <Tooltip label={`${t('open')} (${t('shortcut')})`}>
        <button
          type="button"
          aria-label={t('open')}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="inline-flex size-10 items-center justify-center rounded-md text-ink-700 transition-colors duration-200 hover:bg-ivory-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Search aria-hidden="true" className="size-[1.125rem]" />
        </button>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>{open && <Palette onClose={() => setOpen(false)} />}</Dialog>
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const t = useTranslations('search');
  const tn = useTranslations('nav');
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const entries = React.useMemo(
    () => buildEntries(can as Can, (k) => tn(k as never), (k) => t(`features.${k}` as never), (k) => t(`sections.${k}` as never)),
    [can, tn, t],
  );
  const sectionName = (s: string) => (t.has(`sections.${s}` as never) ? t(`sections.${s}` as never) : tn.has(`sections.${s}` as never) ? tn(`sections.${s}` as never) : s);
  const results = React.useMemo(() => {
    if (q.trim()) return searchEntries(entries, q, 8);
    const seen = new Set<string>();
    return entries.filter((e) => e.id.startsWith('feature.') && !seen.has(e.href + e.title) && seen.add(e.href + e.title)).slice(0, 6);
  }, [entries, q]);
  const go = (href: string) => { onClose(); router.push(href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]!.href); }
  };
  const listId = React.useId();
  return (
    <DialogContent title={t('title')} description={t('hint')} closeLabel={t('close')} size="lg">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-gold-500">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-label={t('title')}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder={t('placeholder')}
          className="h-12 w-full bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">{q.trim() ? t('results') : t('popular')}</p>
      {results.length === 0 ? (
        <p role="status" className="py-6 text-center text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul id={listId} role="listbox" aria-label={t('results')} className="mt-1 max-h-[50vh] divide-y divide-line overflow-y-auto">
          {results.map((r, i) => (
            <li key={r.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => go(r.href)}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left ${i === active ? 'bg-gold-50' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{r.title}</span>
                  {r.description && <span className="block text-sm text-muted">{r.description}</span>}
                </span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{r.id.startsWith('feature.') ? r.section : sectionName(r.section)}</span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-gold-700" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
