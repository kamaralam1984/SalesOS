'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Copy, Link2, PauseCircle, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Combobox,
  DataTable,
  Dialog,
  DialogContent,
  FilterBar,
  FormField,
  Input,
  PageHeader,
  Pagination,
  Select,
  Sheet,
  SheetContent,
  StatusBadge,
  Textarea,
  useToast,
  type Column,
} from '@salesos/ui';
import {
  PRIMARY_ROLE_KEYS,
  SECONDARY_ROLE_KEYS,
  type RoleKey,
  type UserListItem,
} from '@/lib/api/types';
import {
  useCreateUser,
  useDeactivateUser,
  useInviteLink,
  useReactivateUser,
  useSetUserRoles,
  useUpdateUser,
  useUsers,
} from '@/lib/api/hooks/users';
import { emailField } from '@/lib/validation';
import { useAuth, Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useFieldError } from '@/hooks/use-field-error';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { RoleBadges, useDateTimeFormat } from './shared';
import { Hint } from '@/features/hints/hint-views';

const PAGE_SIZE = 20;

export function UsersPage() {
  return (
    <RequirePermission permission="users:view" minScope="team">
      <UsersInner />
    </RequirePermission>
  );
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

function UsersInner() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const { user: me } = useAuth();
  const fmt = useDateTimeFormat();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<'' | 'true' | 'false'>('');
  const [page, setPage] = React.useState(1);
  const debounced = useDebounced(search);
  const q = useUsers({ page, limit: PAGE_SIZE, search: debounced || undefined, isActive: status });
  const apiErr = useApiErrorMessage();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserListItem | null>(null);
  const [roleTarget, setRoleTarget] = React.useState<UserListItem | null>(null);
  const [deactTarget, setDeactTarget] = React.useState<UserListItem | null>(null);
  const [linkTarget, setLinkTarget] = React.useState<UserListItem | null>(null);
  const reactivate = useReactivateUser();
  const { toast } = useToast();

  const columns: Column<UserListItem>[] = [
    {
      id: 'name',
      header: t('colName'),
      primary: true,
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {u.name}
              {u.id === me?.id && (
                <span className="ml-2 text-xs font-normal text-muted">({t('you')})</span>
              )}
            </span>
            <span className="block truncate text-[0.8125rem] text-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    { id: 'roles', header: t('colRoles'), cell: (u) => <RoleBadges roles={u.roles} /> },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (u) =>
        u.isActive ? (
          <StatusBadge status="success">{t('active')}</StatusBadge>
        ) : (
          <StatusBadge status="neutral">{t('inactive')}</StatusBadge>
        ),
    },
    {
      id: 'last',
      header: t('colLastLogin'),
      hideOnMobile: true,
      cell: (u) => <span className="text-muted">{fmt(u.lastLoginAt)}</span>,
    },
  ];

  const total = q.data?.pagination?.total;

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Can permission="users:create">
            <Button
              className="glow-gold glow-hover"
              leadingIcon={<UserPlus className="size-4" aria-hidden="true" />}
              onClick={() => setCreateOpen(true)}
            >
              {t('invite')}
            </Button>
          </Can>
        }
      />
      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        activeCount={(search ? 1 : 0) + (status ? 1 : 0)}
        onClear={() => {
          setSearch('');
          setStatus('');
          setPage(1);
        }}
        clearLabel={tc('clearFilters')}
      >
        <div className="w-full sm:w-44">
          <FormField label={t('colStatus')} hideLabel>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as '' | 'true' | 'false');
                setPage(1);
              }}
            >
              <option value="">{t('allStatuses')}</option>
              <option value="true">{t('active')}</option>
              <option value="false">{t('inactive')}</option>
            </Select>
          </FormField>
        </div>
      </FilterBar>

      <div className="enter-up min-w-0 max-w-full" style={{ ['--enter-delay' as string]: '80ms' }}>
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(u) => u.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={
          q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null
        }
        emptyTitle={t('emptyTitle')}
        emptyDescription={search || status ? t('emptyFiltered') : t('emptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(u) => (
          <>
            <Can permission="users:update">
              <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                {tc('edit')}
              </Button>
            </Can>
            <Can permission="users:role:assign">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<ShieldCheck className="size-4" aria-hidden="true" />}
                onClick={() => setRoleTarget(u)}
              >
                {t('roles')}
              </Button>
            </Can>
            {u.isActive && u.hasPassword === false && (
              <Can permission="users:create">
                <Button size="sm" variant="ghost" leadingIcon={<Link2 className="size-4" aria-hidden="true" />} onClick={() => setLinkTarget(u)}>
                  {t('inviteLink')}
                </Button>
              </Can>
            )}
            <Can permission="users:deactivate">
              {u.isActive ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={u.id === me?.id}
                  leadingIcon={<PauseCircle className="size-4" aria-hidden="true" />}
                  onClick={() => setDeactTarget(u)}
                >
                  {t('deactivate')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={reactivate.isPending && reactivate.variables?.id === u.id}
                  leadingIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                  onClick={() =>
                    reactivate.mutate(
                      { id: u.id },
                      {
                        onSuccess: () =>
                          toast({ tone: 'success', title: t('reactivated', { name: u.name }) }),
                        onError: (e) =>
                          toast({
                            tone: 'danger',
                            title: t('reactivateFailed'),
                            description: apiErr(e).message,
                          }),
                      },
                    )
                  }
                >
                  {t('reactivate')}
                </Button>
              )}
            </Can>
          </>
        )}
      />
      </div>
      {q.data && q.data.items.length > 0 && (
        <Pagination
          className="mt-4 enter-fade"
          page={page}
          hasNext={Boolean(q.data?.pagination?.hasMore)}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          labels={paginationLabels(tc)}
        />
      )}

      <CreateUserSheet open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserSheet user={editing} onClose={() => setEditing(null)} />
      <RolesDialog user={roleTarget} onClose={() => setRoleTarget(null)} />
      <DeactivateDialog user={deactTarget} onClose={() => setDeactTarget(null)} />
      <InviteLinkDialog user={linkTarget} onClose={() => setLinkTarget(null)} />
    </>
  );
}

export function paginationLabels(tc: ReturnType<typeof useTranslations>) {
  return {
    nav: tc('pagination'),
    previous: tc('previous'),
    next: tc('next'),
    summary: (f: number, to: number, total: number) =>
      tc('paginationSummary', { from: f, to, total }),
    page: (p: number, c: number) => tc('paginationPage', { page: p, count: c }),
    pageOnly: (p: number) => tc('paginationPageOnly', { page: p }),
  };
}

/* ------------------------------ Roles picker ------------------------------ */

function RolePicker({
  primary,
  secondary,
  onChange,
  disabledRoles,
}: {
  primary: RoleKey;
  secondary: RoleKey[];
  onChange: (primary: RoleKey, secondary: RoleKey[]) => void;
  disabledRoles: ReadonlySet<RoleKey>;
}) {
  const tr = useTranslations('roles');
  const t = useTranslations('admin.users');
  return (
    <div className="space-y-4">
      <FormField label={t('primaryRole')} hint={t('primaryRoleHint')} required>
        <Select value={primary} onChange={(e) => onChange(e.target.value as RoleKey, secondary)}>
          {PRIMARY_ROLE_KEYS.map((r) => (
            <option key={r} value={r} disabled={disabledRoles.has(r) && r !== primary}>
              {tr(r)}
            </option>
          ))}
        </Select>
      </FormField>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">
          {t('secondaryRoles')} <Hint id="userSecondaryRoles" />
        </legend>
        <p className="mb-2 text-[0.8125rem] text-muted">{t('secondaryRolesHint')}</p>
        <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {SECONDARY_ROLE_KEYS.map((r) => (
            <Checkbox
              key={r}
              label={tr(r)}
              checked={secondary.includes(r)}
              disabled={disabledRoles.has(r) && !secondary.includes(r)}
              onCheckedChange={(c) =>
                onChange(primary, c === true ? [...secondary, r] : secondary.filter((x) => x !== r))
              }
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function useDisabledRoles(): ReadonlySet<RoleKey> {
  const { can } = useAuth();
  return React.useMemo(() => {
    // Founder, HR and Finance grants are founder-only (API enforces; we just avoid offering dead options).
    return can('users:role:assign-sensitive')
      ? new Set<RoleKey>()
      : new Set<RoleKey>(['FOUNDER_CEO', 'HR', 'FINANCE']);
  }, [can]);
}

/* ------------------------------ Create user ------------------------------ */

const createSchema = z.object({
  name: z.string().trim().min(1, 'required').max(120, 'tooLong'),
  email: emailField,
  department: z.string().trim().max(80, 'tooLong').optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateUserSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && <CreateUserBody onOpenChange={onOpenChange} />}
    </Sheet>
  );
}

function CreateUserBody({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const create = useCreateUser();
  const disabled = useDisabledRoles();
  const [primary, setPrimary] = React.useState<RoleKey>('SALES_EXECUTIVE');
  const [secondary, setSecondary] = React.useState<RoleKey[]>([]);
  const [managerId, setManagerId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mgrQuery, setMgrQuery] = React.useState('');
  const mgrDebounced = useDebounced(mgrQuery, 250);
  const managers = useUsers({
    page: 1,
    limit: 20,
    search: mgrDebounced || undefined,
    isActive: 'true',
  });
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email: '', department: '' },
  });

  async function onSubmit(v: CreateForm) {
    setError(null);
    try {
      await create.mutateAsync({ ...v, department: v.department || undefined, roles: [primary, ...secondary], managerId });
      toast({
        tone: 'success',
        title: t('created', { name: v.name }),
        description: t('createdHelp'),
      });
      onOpenChange(false);
    } catch (e) {
      const { message } = apiErr(e);
      const fields = (e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
      if (fields.email) form.setError('email', { message: fields.email });
      else setError(message);
    }
  }

  return (
    <SheetContent
      title={t('inviteTitle')}
      description={t('inviteDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form="create-user-form"
            loading={create.isPending}
            loadingLabel={tc('saving')}
            leadingIcon={
              create.isPending ? undefined : <Plus className="size-4" aria-hidden="true" />
            }
          >
            {t('sendInvite')}
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="space-y-5"
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('fieldName')} error={fe(form.formState.errors.name)} required>
          <Input autoComplete="off" {...form.register('name')} />
        </FormField>
        <FormField label={t('fieldDepartment')} hint={t('fieldDepartmentHint')} error={fe(form.formState.errors.department)}>
          <Input {...form.register('department')} />
        </FormField>
        <FormField label={t('fieldEmail')} error={fe(form.formState.errors.email)} required>
          <Input
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            {...form.register('email')}
          />
        </FormField>
        <RolePicker
          primary={primary}
          secondary={secondary}
          disabledRoles={disabled}
          onChange={(p, s) => {
            setPrimary(p);
            setSecondary(s);
          }}
        />
        <FormField label={t('fieldManager')} hint={t('fieldManagerHint')}>
          <Combobox
            options={(managers.data?.items ?? []).map((u) => ({
              value: u.id,
              label: u.name,
              description: u.email,
            }))}
            value={managerId}
            onValueChange={setManagerId}
            onQueryChange={setMgrQuery}
            loading={managers.isFetching}
            placeholder={t('noManager')}
            emptyText={tc('noMatches')}
            clearLabel={tc('clear')}
          />
        </FormField>
      </form>
    </SheetContent>
  );
}

/* ------------------------------ Edit user ------------------------------ */

function EditUserSheet({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      {user && <EditUserBody key={user.id} user={user} onClose={onClose} />}
    </Sheet>
  );
}

function EditUserBody({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const update = useUpdateUser(user.id);
  const [managerId, setManagerId] = React.useState<string | null>(user.managerId ?? null);
  const [mgrQuery, setMgrQuery] = React.useState('');
  const mgrDebounced = useDebounced(mgrQuery, 250);
  const managers = useUsers({
    page: 1,
    limit: 20,
    search: mgrDebounced || undefined,
    isActive: 'true',
  });
  const [error, setError] = React.useState<string | null>(null);
  const schema = z.object({ name: z.string().trim().min(1, 'required').max(120, 'tooLong'), department: z.string().trim().max(80, 'tooLong').optional() });
  const form = useForm<{ name: string; department?: string }>({
    resolver: zodResolver(schema),
    defaultValues: { name: user.name, department: user.department ?? '' },
  });

  async function onSubmit(v: { name: string; department?: string }) {
    setError(null);
    try {
      await update.mutateAsync({ name: v.name, managerId, department: v.department?.trim() ? v.department.trim() : null });
      toast({ tone: 'success', title: t('updated') });
      onClose();
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  const options = (managers.data?.items ?? [])
    .filter((u) => u.id !== user.id)
    .map((u) => ({ value: u.id, label: u.name, description: u.email }));
  // Keep the current manager selectable even when not in the first search page.
  const current = user.managerId;
  if (current && !options.some((o) => o.value === current))
    options.unshift({ value: current, label: t('currentManager'), description: '' });

  return (
    <SheetContent
      title={t('editTitle')}
      description={user.email}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form="edit-user-form"
            loading={update.isPending}
            loadingLabel={tc('saving')}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-user-form"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="space-y-5"
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('fieldName')} error={fe(form.formState.errors.name)} required>
          <Input {...form.register('name')} />
        </FormField>
        <FormField label={t('fieldDepartment')} hint={t('fieldDepartmentHint')} error={fe(form.formState.errors.department)}>
          <Input {...form.register('department')} />
        </FormField>
        <FormField label={t('fieldEmail')} hint={t('emailReadonly')}>
          <Input value={user.email} readOnly />
        </FormField>
        <FormField label={t('fieldManager')} hint={t('fieldManagerHint')}>
          <Combobox
            options={options}
            value={managerId}
            onValueChange={setManagerId}
            onQueryChange={setMgrQuery}
            loading={managers.isFetching}
            placeholder={t('noManager')}
            emptyText={tc('noMatches')}
            clearLabel={tc('clear')}
          />
        </FormField>
      </form>
    </SheetContent>
  );
}

/* ------------------------------ Role assignment ------------------------------ */

function RolesDialog({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      {user && <RolesBody key={user.id} user={user} onClose={onClose} />}
    </Dialog>
  );
}

function RolesBody({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const setRoles = useSetUserRoles();
  const disabled = useDisabledRoles();
  const initialPrimary = (user.roles.find((r) =>
    (PRIMARY_ROLE_KEYS as readonly string[]).includes(r),
  ) ?? 'SALES_EXECUTIVE') as RoleKey;
  const [primary, setPrimary] = React.useState<RoleKey>(initialPrimary);
  const [secondary, setSecondary] = React.useState<RoleKey[]>(
    user.roles.filter((r) => r !== initialPrimary),
  );
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await setRoles.mutateAsync({ id: user.id, roles: [primary, ...secondary] });
      toast({ tone: 'success', title: t('rolesUpdated', { name: user.name }) });
      onClose();
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <DialogContent
      title={t('rolesTitle', { name: user.name })}
      description={t('rolesDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            loading={setRoles.isPending}
            loadingLabel={tc('saving')}
          >
            {t('saveRoles')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="info">{t('rolesAudited')}</Alert>
        <RolePicker
          primary={primary}
          secondary={secondary}
          disabledRoles={disabled}
          onChange={(p, s) => {
            setPrimary(p);
            setSecondary(s);
          }}
        />
      </div>
    </DialogContent>
  );
}

/* ------------------------------ Deactivate ------------------------------ */

function DeactivateDialog({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      {user && <DeactivateBody key={user.id} user={user} onClose={onClose} />}
    </Dialog>
  );
}

function DeactivateBody({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const deact = useDeactivateUser();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      await deact.mutateAsync({ id: user.id, reason: reason.trim() || undefined });
      toast({
        tone: 'success',
        title: t('deactivated', { name: user.name }),
        description: t('deactivatedHelp'),
      });
      onClose();
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <DialogContent
      size="sm"
      title={t('deactivateTitle', { name: user.name })}
      description={t('deactivateDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            loading={deact.isPending}
            loadingLabel={tc('saving')}
          >
            {t('deactivateConfirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="warning">{t('deactivateWarning')}</Alert>
        <FormField label={t('reason')} hint={t('reasonHint')}>
          <Textarea
            rows={3}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      </div>
    </DialogContent>
  );
}

/* ------------------------------ Manual invite link ------------------------------ */

function InviteLinkDialog({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      {user && <InviteLinkBody key={user.id} user={user} onClose={onClose} />}
    </Dialog>
  );
}

function InviteLinkBody({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const issue = useInviteLink();
  const [link, setLink] = React.useState<{ link: string; expiresAt: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function generate() {
    setError(null);
    try {
      setLink(await issue.mutateAsync({ id: user.id }));
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      toast({ tone: 'success', title: t('inviteLinkCopied') });
    } catch {
      toast({ tone: 'danger', title: t('inviteLinkCopyFailed') });
    }
  }

  return (
    <DialogContent
      size="md"
      title={t('inviteLinkTitle', { name: user.name })}
      description={t('inviteLinkDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tc('close')}</Button>
          {link ? (
            <Button leadingIcon={<Copy className="size-4" aria-hidden="true" />} onClick={() => void copy()}>{t('inviteLinkCopy')}</Button>
          ) : (
            <Button onClick={() => void generate()} loading={issue.isPending} loadingLabel={tc('saving')}>{t('inviteLinkGenerate')}</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="warning">{t('inviteLinkWarning')}</Alert>
        {link && (
          <FormField label={t('inviteLinkLabel')} hint={t('inviteLinkExpires', { when: new Date(link.expiresAt).toLocaleString() })}>
            <Input readOnly value={link.link} onFocus={(e) => e.currentTarget.select()} />
          </FormField>
        )}
      </div>
    </DialogContent>
  );
}
