'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Combobox,
  DataTable,
  Dialog,
  DialogContent,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
  useToast,
  type Column,
} from '@salesos/ui';
import type { Team, TeamMember } from '@/lib/api/types';
import {
  useAddTeamMember,
  useCreateTeam,
  useRemoveTeamMember,
  useTeamMembers,
  useTeams,
} from '@/lib/api/hooks/teams';
import { useOrgSettings } from '@/lib/api/hooks/admin';
import { useUsers } from '@/lib/api/hooks/users';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useFieldError } from '@/hooks/use-field-error';
import { useApiErrorMessage } from '@/hooks/use-api-error';

const TEAMS_READ = ['teams:view'];
const TEAMS_MANAGE = ['teams:create', 'teams:update'];

export function TeamsPage() {
  return (
    <RequirePermission permission={TEAMS_READ} minScope="team">
      <TeamsInner />
    </RequirePermission>
  );
}

function TeamsInner() {
  const t = useTranslations('admin.teams');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErr = useApiErrorMessage();
  const teams = useTeams();
  const settings = useOrgSettings();
  const [createOpen, setCreateOpen] = React.useState(false);
  const limit = settings.data?.teamSoftLimit;

  const columns: Column<Team>[] = [
    {
      id: 'name',
      header: t('colName'),
      primary: true,
      cell: (team) => (
        <Link
          href={`/admin/teams/${team.id}`}
          className="inline-flex items-center gap-2.5 font-medium text-ink hover:underline"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-md bg-gold-50 text-gold-700 ring-1 ring-gold-300/70"
          >
            <UsersRound className="size-4" />
          </span>
          {team.name}
        </Link>
      ),
    },
    {
      id: 'members',
      header: t('colMembers'),
      cell: (team) => {
        const total = team.memberCount ?? team.members?.length;
        // The lead is a member row but not one of the "executives per manager".
        const n = total === undefined ? undefined : total - (team.leadUserId ? 1 : 0);
        if (n === undefined) return <span className="text-muted">—</span>;
        const over = limit !== undefined && n > limit;
        return (
          <span className="inline-flex items-center gap-2">
            <span className="tabular">{n}</span>
            {over && <StatusBadge status="warning">{t('overLimit', { limit })}</StatusBadge>}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description', { limit: limit ?? '—' })}
        actions={
          <Can permission={TEAMS_MANAGE}>
            <Button
              leadingIcon={<UsersRound className="size-4" aria-hidden="true" />}
              onClick={() => setCreateOpen(true)}
            >
              {t('create')}
            </Button>
          </Can>
        }
      />
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={teams.data?.items}
        getRowId={(x) => x.id}
        loading={teams.isPending}
        loadingLabel={tc('loading')}
        error={
          teams.isError
            ? { message: apiErr(teams.error).message, onRetry: () => void teams.refetch() }
            : null
        }
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        onRowClick={(x) => router.push(`/admin/teams/${x.id}`)}
      />
      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <CreateTeamBody onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function CreateTeamBody({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('admin.teams');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const router = useRouter();
  const create = useCreateTeam();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<{ name: string }>({
    resolver: zodResolver(
      z.object({ name: z.string().trim().min(1, 'required').max(120, 'tooLong') }),
    ),
    defaultValues: { name: '' },
  });
  async function onSubmit(v: { name: string }) {
    setError(null);
    try {
      const team = await create.mutateAsync({ name: v.name });
      toast({ tone: 'success', title: t('created', { name: v.name }) });
      onOpenChange(false);
      if (team?.id) router.push(`/admin/teams/${team.id}`);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <DialogContent
      size="sm"
      title={t('createTitle')}
      description={t('createDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form="create-team-form"
            loading={create.isPending}
            loadingLabel={tc('saving')}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        id="create-team-form"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="space-y-4"
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('fieldName')} error={fe(form.formState.errors.name)} required>
          <Input autoComplete="off" {...form.register('name')} />
        </FormField>
      </form>
    </DialogContent>
  );
}

/* ------------------------------ Team detail ------------------------------ */

export function TeamDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission={TEAMS_READ} minScope="team">
      <TeamDetailInner id={id} />
    </RequirePermission>
  );
}

function TeamDetailInner({ id }: { id: string }) {
  const t = useTranslations('admin.teams');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const teamsQ = useTeams();
  const team = {
    ...teamsQ,
    data: teamsQ.data ? { team: teamsQ.data.items.find((x) => x.id === id) ?? null } : undefined,
  };
  const membersQ = useTeamMembers(id);
  const settings = useOrgSettings();
  const add = useAddTeamMember(id);
  const remove = useRemoveTeamMember(id);
  const [pick, setPick] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState<TeamMember | null>(null);
  const users = useUsers({ page: 1, limit: 20, search: q || undefined, isActive: 'true' });
  const [warnings, setWarnings] = React.useState<string[]>([]);

  const members = membersQ.data?.members ?? [];
  const limit = settings.data?.teamSoftLimit;
  const execCount = members.filter((m) => m.membershipRole !== 'LEAD').length;
  const over = limit !== undefined && execCount > limit;
  const atLimit = limit !== undefined && execCount === limit;
  const memberIds = new Set(members.map((m) => m.userId));

  if (team.isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tc('loading')}</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (team.isError || !team.data?.team) {
    return (
      <ErrorState
        description={apiErr(team.error).message}
        onRetry={() => void teamsQ.refetch()}
        retryLabel={tc('retry')}
      />
    );
  }
  const t0 = team.data.team;

  const columns: Column<TeamMember>[] = [
    {
      id: 'name',
      header: t('colMember'),
      primary: true,
      cell: (m) => (
        <span className="flex items-center gap-3">
          <Avatar name={m.name ?? m.userId} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.name ?? m.userId}</span>
            {m.email && (
              <span className="block truncate text-[0.8125rem] text-muted">{m.email}</span>
            )}
          </span>
        </span>
      ),
    },
    {
      id: 'role',
      header: t('colRole'),
      cell: (m) =>
        m.membershipRole === 'LEAD' ? (
          <Badge tone="gold">{t('lead')}</Badge>
        ) : (
          <Badge>{t('member')}</Badge>
        ),
    },
  ];

  async function addMember() {
    if (!pick) return;
    setWarnings([]);
    try {
      const r = await add.mutateAsync({ userId: pick, membershipRole: 'MEMBER' });
      setWarnings(r.warnings);
      setPick(null);
      toast({ tone: 'success', title: t('memberAdded') });
    } catch (e) {
      toast({ tone: 'danger', title: t('memberAddFailed'), description: apiErr(e).message });
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('title'), href: '/admin/teams' }, { label: t0.name }]}
        breadcrumbLabel={tc('breadcrumb')}
        eyebrow={t('eyebrow')}
        title={t0.name}
        description={t('detailDescription', { count: execCount })}
      />
      {(over || warnings.length > 0) && (
        <Alert tone="warning" className="mb-5" title={t('softLimitTitle')}>
          {t('softLimitBody', { count: execCount, limit: limit ?? 0 })}
          {warnings.map((w) => (
            <span key={w} className="mt-1 block text-ink-600">
              {w}
            </span>
          ))}
        </Alert>
      )}
      {!over && atLimit && (
        <Alert tone="info" className="mb-5" title={t('atLimitTitle')}>
          {t('atLimitBody', { limit: limit ?? 0 })}
        </Alert>
      )}

      <div className="stagger grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel accent="gold" title={t('membersTitle')} description={t('membersDescription')}>
          <DataTable
            caption={t('membersTitle')}
            columns={columns}
            rows={members}
            getRowId={(m) => m.userId}
            loading={membersQ.isPending}
            loadingLabel={tc('loading')}
            emptyTitle={t('noMembers')}
            emptyDescription={t('noMembersHelp')}
            actionsHeader={tc('actions')}
            rowActions={(m) => (
              <Can permission={TEAMS_MANAGE}>
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<UserMinus className="size-4" aria-hidden="true" />}
                  onClick={() => setConfirmRemove(m)}
                >
                  {t('remove')}
                </Button>
              </Can>
            )}
          />
        </Panel>

        <Can permission={TEAMS_MANAGE}>
          <Card as="section" aria-labelledby="add-member-h" accent="gold" className="h-fit">
            <h2 id="add-member-h" className="font-display text-lg font-semibold">
              {t('addMember')}
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted">{t('addMemberHelp')}</p>
            <FormField label={t('chooseUser')}>
              <Combobox
                options={(users.data?.items ?? [])
                  .filter((u) => !memberIds.has(u.id))
                  .map((u) => ({ value: u.id, label: u.name, description: u.email }))}
                value={pick}
                onValueChange={setPick}
                onQueryChange={setQ}
                loading={users.isFetching}
                placeholder={t('searchUsers')}
                emptyText={tc('noMatches')}
                clearLabel={tc('clear')}
              />
            </FormField>
            <Button
              className="mt-4 w-full"
              disabled={!pick}
              loading={add.isPending}
              loadingLabel={tc('saving')}
              leadingIcon={<UserPlus className="size-4" aria-hidden="true" />}
              onClick={() => void addMember()}
            >
              {t('addMember')}
            </Button>
            <p className="mt-3 flex items-start gap-2 text-[0.8125rem] text-muted">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-gold-700"
              />
              {t('softLimitNote', { limit: limit ?? '—' })}
            </p>
          </Card>
        </Can>
      </div>

      <Dialog open={Boolean(confirmRemove)} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent
          size="sm"
          title={t('removeTitle', { name: confirmRemove?.name ?? '' })}
          description={t('removeDescription')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                loadingLabel={tc('saving')}
                onClick={() =>
                  confirmRemove &&
                  remove.mutate(confirmRemove.userId, {
                    onSuccess: () => {
                      toast({ tone: 'success', title: t('memberRemoved') });
                      setConfirmRemove(null);
                    },
                    onError: (e) =>
                      toast({
                        tone: 'danger',
                        title: t('memberRemoveFailed'),
                        description: apiErr(e).message,
                      }),
                  })
                }
              >
                {t('remove')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-700">{t('removeBody')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
