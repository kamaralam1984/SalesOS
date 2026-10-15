'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, DataTable, FormField, Input, Panel, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger, useToast, type Column } from '@salesos/ui';
import { PageHeader } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMembers, useTeams } from '@/lib/api/hooks/teams';
import {
  useAssignRules,
  useCreateCampaign,
  useCreateLostReason,
  useCreateProgram,
  useCreateSource,
  useCreateStage,
  useLostReasons,
  usePrograms,
  useRules,
  useSources,
  useStages,
  useUpdateLostReason,
  useUpdateProgram,
  useUpdateSource,
  useUpdateStage,
  useUpsertAssignRule,
  useUpsertRule,
  type RuleRow,
} from '@/lib/api/hooks/crm-admin';
import { CrmFrame, DataState } from './common';
import { humanize } from './lib';

export function SettingsPage() {
  return (
    <RequirePermission permission="settings:view">
      <CrmFrame>
        <SettingsInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function SettingsInner() {
  const t = useTranslations('crm.settings');
  const { can } = useAuth();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Tabs defaultValue="programs" className="enter-up">
        <TabsList aria-label={t('sections')} className="mb-4 max-w-full overflow-x-auto">
          {can('programs:view') && <TabsTrigger value="programs">{t('programs')}</TabsTrigger>}
          {can('sources:view') && <TabsTrigger value="sources">{t('sources')}</TabsTrigger>}
          <TabsTrigger value="stages">{t('stages')}</TabsTrigger>
          <TabsTrigger value="lost">{t('lostReasons')}</TabsTrigger>
          <TabsTrigger value="rules">{t('automation')}</TabsTrigger>
          <TabsTrigger value="rr">{t('roundRobin')}</TabsTrigger>
        </TabsList>
        <TabsContent value="programs"><ProgramsTab /></TabsContent>
        <TabsContent value="sources"><SourcesTab /></TabsContent>
        <TabsContent value="stages"><StagesTab /></TabsContent>
        <TabsContent value="lost"><LostTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
        <TabsContent value="rr"><RoundRobinTab /></TabsContent>
      </Tabs>
    </>
  );
}

function useAction() {
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const t = useTranslations('crm.settings');
  const [error, setError] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, okMsg = t('saved')) => {
    setError(null);
    try {
      await fn();
      toast({ tone: 'success', title: okMsg });
      return true;
    } catch (e) {
      setError(apiErr(e).message);
      return false;
    }
  };
  return { run, error };
}

/* ---------------------------------------------------------------- programs */
function ProgramsTab() {
  const t = useTranslations('crm.settings');
  const tc = useTranslations('common');
  const q = usePrograms();
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const { run, error } = useAction();
  const [v, setV] = React.useState({ code: '', name: '', kind: 'PROGRAM' });
  const cols: Column<NonNullable<typeof q.data>[number]>[] = [
    { id: 'name', header: t('colName'), primary: true, cell: (p) => p.name },
    { id: 'code', header: t('colCode'), cell: (p) => <code className="text-xs">{p.code}</code> },
    { id: 'kind', header: t('colKind'), cell: (p) => humanize(p.kind) },
    { id: 'active', header: t('colActive'), cell: (p) => <Badge tone={p.isActive ? 'green' : 'neutral'}>{p.isActive ? t('active') : t('inactive')}</Badge> },
  ];
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-sm text-muted">{t('programsHint')}</p>
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('noPrograms') }}>
        {(rows) => (
          <DataTable caption={t('programs')} columns={cols} rows={rows} getRowId={(p) => p.id} loadingLabel={tc('loading')} actionsHeader={tc('actions')}
            rowActions={(p) => (<Can permission="programs:manage"><Button size="sm" variant="secondary" onClick={() => void run(() => update.mutateAsync({ id: p.id, isActive: !p.isActive }))}>{p.isActive ? t('deactivate') : t('activate')}</Button></Can>)} />
        )}
      </DataState>
      <Can permission="programs:manage">
        <Panel title={t('addProgram')}>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => create.mutateAsync(v))) setV({ code: '', name: '', kind: 'PROGRAM' }); }}>
            <FormField label={t('colCode')} required><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></FormField>
            <FormField label={t('colName')} required className="sm:col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
            <FormField label={t('colKind')}>
              <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="PROGRAM">{t('kindPROGRAM')}</option><option value="EVENT">{t('kindEVENT')}</option><option value="APP">{t('kindAPP')}</option></Select>
            </FormField>
            <div className="sm:col-span-4"><Button type="submit" loading={create.isPending} disabled={!v.code.trim() || !v.name.trim()}>{t('add')}</Button></div>
          </form>
        </Panel>
      </Can>
    </div>
  );
}

/* ---------------------------------------------------------------- sources */
function SourcesTab() {
  const t = useTranslations('crm.settings');
  const q = useSources();
  const create = useCreateSource();
  const update = useUpdateSource();
  const camp = useCreateCampaign();
  const { run, error } = useAction();
  const [v, setV] = React.useState({ name: '', type: 'CAMPAIGN' });
  const [c, setC] = React.useState<{ sourceId: string; name: string }>({ sourceId: '', name: '' });
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('noSources') }}>
        {(rows) => (
          <ul className="stagger-fast divide-y divide-line rounded-lg border border-line bg-surface">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-ivory-100">
                <div className="min-w-0 break-words">
                  <p className="font-medium text-ink">{s.name} <Badge tone={s.isActive ? 'green' : 'neutral'}>{humanize(s.type)}</Badge></p>
                  <p className="text-xs text-muted">{s.campaigns.length ? s.campaigns.map((x) => x.name).join(', ') : t('noCampaigns')}</p>
                </div>
                <Can permission="sources:manage"><Button size="sm" variant="secondary" onClick={() => void run(() => update.mutateAsync({ id: s.id, isActive: !s.isActive }))}>{s.isActive ? t('deactivate') : t('activate')}</Button></Can>
              </li>
            ))}
          </ul>
        )}
      </DataState>
      <Can permission="sources:manage">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title={t('addSource')}>
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => create.mutateAsync(v))) setV({ name: '', type: 'CAMPAIGN' }); }}>
              <FormField label={t('colName')} required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
              <FormField label={t('colKind')}>
                <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{['CAMPAIGN', 'WEBINAR', 'REFERRAL', 'WEBSITE', 'IMPORT', 'MANUAL', 'OTHER'].map((x) => (<option key={x} value={x}>{humanize(x)}</option>))}</Select>
              </FormField>
              <Button type="submit" loading={create.isPending} disabled={!v.name.trim()}>{t('add')}</Button>
            </form>
          </Panel>
          <Panel title={t('addCampaign')}>
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => camp.mutateAsync(c))) setC({ ...c, name: '' }); }}>
              <FormField label={t('sourceLabel')} required>
                <Select value={c.sourceId} onChange={(e) => setC({ ...c, sourceId: e.target.value })}><option value="">{t('choose')}</option>{(q.data ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</Select>
              </FormField>
              <FormField label={t('colName')} required><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></FormField>
              <Button type="submit" loading={camp.isPending} disabled={!c.sourceId || !c.name.trim()}>{t('add')}</Button>
            </form>
          </Panel>
        </div>
      </Can>
    </div>
  );
}

/* ---------------------------------------------------------------- stages */
function StagesTab() {
  const t = useTranslations('crm.settings');
  const q = useStages();
  const update = useUpdateStage();
  const create = useCreateStage();
  const { run, error } = useAction();
  const [v, setV] = React.useState({ key: '', label: '', category: 'OPEN', sortOrder: '35' });
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Alert tone="info">{t('stagesHint')}</Alert>
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('noStages') }}>
        {(rows) => (
          <div className="enter-up overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label={t('sections')}>
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">{t('stages')}</caption>
              <thead className="bg-ivory-100 text-left text-xs"><tr><th scope="col" className="px-3 py-2">{t('colOrder')}</th><th scope="col" className="px-3 py-2">{t('colName')}</th><th scope="col" className="px-3 py-2">{t('colCategory')}</th><th scope="col" className="px-3 py-2">{t('skippable')}</th><th scope="col" className="px-3 py-2">{t('canClose')}</th><th scope="col" className="px-3 py-2">{t('colActive')}</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-t border-line transition-colors hover:bg-ivory-100">
                    <td className="px-3 py-2 tabular">{s.sortOrder}</td>
                    <td className="px-3 py-2 font-medium">{s.label} <code className="text-xs text-muted">{s.key}</code></td>
                    <td className="px-3 py-2">{humanize(s.category)}</td>
                    <td className="px-3 py-2"><Can permission="settings:update" fallback={<span>{s.skippable ? '✓' : '—'}</span>}><Switch aria-label={`${s.label} ${t('skippable')}`} checked={s.skippable} onCheckedChange={(c) => void run(() => update.mutateAsync({ id: s.id, skippable: c }))} /></Can></td>
                    <td className="px-3 py-2"><Can permission="settings:update" fallback={<span>{s.canClose ? '✓' : '—'}</span>}><Switch aria-label={`${s.label} ${t('canClose')}`} checked={s.canClose} onCheckedChange={(c) => void run(() => update.mutateAsync({ id: s.id, canClose: c }))} /></Can></td>
                    <td className="px-3 py-2"><Can permission="settings:update" fallback={<span>{s.isActive ? '✓' : '—'}</span>}><Switch aria-label={`${s.label} ${t('colActive')}`} checked={s.isActive} onCheckedChange={(c) => void run(() => update.mutateAsync({ id: s.id, isActive: c }))} /></Can></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      <Can permission="settings:update">
        <Panel title={t('addStage')}>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => create.mutateAsync({ key: v.key.trim().toUpperCase().replace(/\s+/g, '_'), label: v.label.trim(), category: v.category, sortOrder: Number(v.sortOrder), skippable: false, canClose: false }))) setV({ ...v, key: '', label: '' }); }}>
            <FormField label={t('stageKey')} required hint={t('stageKeyHint')}><Input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></FormField>
            <FormField label={t('colName')} required><Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></FormField>
            <FormField label={t('colCategory')}><Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{['OPEN', 'NURTURE'].map((x) => (<option key={x} value={x}>{humanize(x)}</option>))}</Select></FormField>
            <FormField label={t('colOrder')}><Input inputMode="numeric" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></FormField>
            <div className="sm:col-span-4"><Button type="submit" loading={create.isPending} disabled={!v.key.trim() || !v.label.trim()}>{t('add')}</Button></div>
          </form>
        </Panel>
      </Can>
    </div>
  );
}

/* ---------------------------------------------------------------- lost reasons */
function LostTab() {
  const t = useTranslations('crm.settings');
  const q = useLostReasons();
  const update = useUpdateLostReason();
  const create = useCreateLostReason();
  const { run, error } = useAction();
  const [v, setV] = React.useState({ key: '', label: '', requiresNote: false, days: '' });
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Alert tone="info">{t('lostHint')}</Alert>
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('noLost') }}>
        {(rows) => (
          <div className="enter-up overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label={t('sections')}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t('lostReasons')}</caption>
              <thead className="bg-ivory-100 text-left text-xs"><tr><th scope="col" className="px-3 py-2">{t('colName')}</th><th scope="col" className="px-3 py-2">{t('requiresNote')}</th><th scope="col" className="px-3 py-2">{t('reactivateAfter')}</th><th scope="col" className="px-3 py-2">{t('colActive')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line transition-colors hover:bg-ivory-100">
                    <td className="px-3 py-2 font-medium">{r.label} <code className="text-xs text-muted">{r.key}</code></td>
                    <td className="px-3 py-2"><Can permission="settings:update" fallback={<span>{r.requiresNote ? '✓' : '—'}</span>}><Switch aria-label={`${r.label} ${t('requiresNote')}`} checked={r.requiresNote} onCheckedChange={(c) => void run(() => update.mutateAsync({ id: r.id, requiresNote: c }))} /></Can></td>
                    <td className="px-3 py-2">{r.reactivateAfterDays ? t('days', { n: r.reactivateAfterDays }) : t('never')}</td>
                    <td className="px-3 py-2"><Can permission="settings:update" fallback={<span>{r.isActive ? '✓' : '—'}</span>}><Switch aria-label={`${r.label} ${t('colActive')}`} checked={r.isActive} onCheckedChange={(c) => void run(() => update.mutateAsync({ id: r.id, isActive: c }))} /></Can></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      <Can permission="settings:update">
        <Panel title={t('addLost')}>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => create.mutateAsync({ key: v.key.trim().toUpperCase().replace(/\s+/g, '_'), label: v.label.trim(), requiresNote: v.requiresNote, reactivateAfterDays: v.days ? Number(v.days) : null }))) setV({ key: '', label: '', requiresNote: false, days: '' }); }}>
            <FormField label={t('stageKey')} required><Input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></FormField>
            <FormField label={t('colName')} required><Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></FormField>
            <FormField label={t('reactivateAfter')} hint={t('reactivateHint')}><Input inputMode="numeric" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></FormField>
            <div className="flex items-end"><Switch label={t('requiresNote')} checked={v.requiresNote} onCheckedChange={(c) => setV({ ...v, requiresNote: c })} /></div>
            <div className="sm:col-span-4"><Button type="submit" loading={create.isPending} disabled={!v.key.trim() || !v.label.trim()}>{t('add')}</Button></div>
          </form>
        </Panel>
      </Can>
    </div>
  );
}

/* ---------------------------------------------------------------- automation rules */
function RulesTab() {
  const t = useTranslations('crm.settings');
  const q = useRules();
  const teams = useTeams();
  const [team, setTeam] = React.useState('');
  return (
    <div className="space-y-4">
      <Alert tone="info">{t('rulesHint')}</Alert>
      <FormField label={t('scope')} className="max-w-xs">
        <Select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">{t('orgDefault')}</option>
          {(teams.data?.items ?? []).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
        </Select>
      </FormField>
      <DataState q={q} isEmpty={(d) => d.length === 0} empty={{ title: t('noRules') }}>
        {(rows) => {
          const org = rows.filter((r) => r.teamId === null);
          return (
            <div className="stagger grid gap-4 lg:grid-cols-2">
              {org.map((base) => {
                const override = team ? rows.find((r) => r.teamId === team && r.ruleKey === base.ruleKey) : undefined;
                return <RuleCard key={`${base.ruleKey}-${team}`} base={override ?? base} teamId={team || null} isOverride={Boolean(override)} />;
              })}
            </div>
          );
        }}
      </DataState>
    </div>
  );
}

const ruleLabel = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function RuleCard({ base, teamId, isOverride }: { base: RuleRow; teamId: string | null; isOverride: boolean }) {
  const t = useTranslations('crm.settings');
  const upsert = useUpsertRule();
  const { run, error } = useAction();
  const [cfg, setCfg] = React.useState<Record<string, unknown>>(() => ({ ...base.config }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(base.config);
  const parse = (k: string, raw: string) => {
    const orig = base.config[k];
    if (typeof orig === 'number') return raw === '' ? 0 : Number(raw);
    if (Array.isArray(orig)) return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (typeof orig[0] === 'number' ? Number(x) : x));
    return raw;
  };
  return (
    <Panel title={base.ruleKey.replace(/_/g, ' ')} description={base.description} headingLevel={3} data-rule={base.ruleKey}>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <p className="mb-3 text-xs text-muted">{teamId ? (isOverride ? t('teamOverride') : t('inheritsOrg')) : base.isDefault ? t('usingDefaults') : t('customised')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(cfg).map(([k, val]) =>
          typeof val === 'boolean' ? (
            <Switch key={k} label={ruleLabel(k)} checked={val} onCheckedChange={(c) => setCfg({ ...cfg, [k]: c })} />
          ) : (
            <FormField key={k} label={ruleLabel(k)}>
              <Input value={Array.isArray(val) ? val.join(', ') : String(val)} inputMode={typeof val === 'number' ? 'numeric' : undefined} onChange={(e) => setCfg({ ...cfg, [k]: parse(k, e.target.value) })} />
            </FormField>
          ),
        )}
      </div>
      <Can permission="settings:update">
        <div className="mt-4">
          <Button size="sm" disabled={!dirty && (!teamId || isOverride)} loading={upsert.isPending} onClick={() => void run(() => upsert.mutateAsync({ ruleKey: base.ruleKey, teamId, config: cfg }))}>
            {teamId && !isOverride ? t('createOverride') : t('saveRule')}
          </Button>
        </div>
      </Can>
    </Panel>
  );
}

/* ---------------------------------------------------------------- round robin */
function RoundRobinTab() {
  const t = useTranslations('crm.settings');
  const teams = useTeams();
  const rules = useAssignRules();
  return (
    <div className="space-y-4">
      <Alert tone="info">{t('rrHint')}</Alert>
      <DataState q={teams} isEmpty={(d) => d.items.length === 0} empty={{ title: t('noTeams') }}>
        {(d) => (
          <div className="stagger grid gap-4 lg:grid-cols-2">
            {d.items.map((team) => (<RoundRobinCard key={team.id} team={team} rule={rules.data?.find((r) => r.teamId === team.id)} />))}
          </div>
        )}
      </DataState>
    </div>
  );
}

function RoundRobinCard({ team, rule }: { team: { id: string; name: string }; rule?: { isEnabled: boolean; dailyCap: number | null; excludedUserIds: string[] } }) {
  const t = useTranslations('crm.settings');
  const members = useTeamMembers(team.id);
  const upsert = useUpsertAssignRule();
  const { run, error } = useAction();
  const [enabled, setEnabled] = React.useState(rule?.isEnabled ?? false);
  const [cap, setCap] = React.useState(rule?.dailyCap ? String(rule.dailyCap) : '');
  const [excluded, setExcluded] = React.useState<string[]>(rule?.excludedUserIds ?? []);
  return (
    <Panel title={team.name} headingLevel={3} data-team-rule={team.id}>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <div className="space-y-3">
        <Switch label={t('rrEnabled')} description={t('rrEnabledHint')} checked={enabled} onCheckedChange={setEnabled} />
        <FormField label={t('rrCap')} hint={t('rrCapHint')}><Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} /></FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('rrExcluded')}</legend>
          {(members.data?.members ?? []).filter((m) => m.membershipRole !== 'LEAD').map((m) => (
            <label key={m.userId} className="flex min-h-9 cursor-pointer items-center gap-2 py-1 text-sm">
              <input type="checkbox" className="size-4 accent-gold-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" checked={excluded.includes(m.userId)} onChange={(e) => setExcluded((x) => (e.target.checked ? [...x, m.userId] : x.filter((i) => i !== m.userId)))} />
              {m.name ?? m.userId}
            </label>
          ))}
        </fieldset>
        <Can permission="settings:update">
          <Button size="sm" loading={upsert.isPending} onClick={() => void run(() => upsert.mutateAsync({ teamId: team.id, isEnabled: enabled, dailyCap: cap ? Number(cap) : null, excludedUserIds: excluded }))}>{t('saveRule')}</Button>
        </Can>
      </div>
    </Panel>
  );
}
