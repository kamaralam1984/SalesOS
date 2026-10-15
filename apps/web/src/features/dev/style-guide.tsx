'use client';
import * as React from 'react';
import { ThemeSegmented } from '@/components/theme/theme-switcher';
import { useTheme } from '@/components/theme/theme-provider';
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  ChartCard,
  Checkbox,
  Combobox,
  DataTable,
  DatePicker,
  Dialog,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorState,
  FilterBar,
  FormField,
  Input,
  LoadingRegion,
  PageHeader,
  Pagination,
  Panel,
  PermissionDenied,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  SkeletonText,
  Stat,
  StageChips,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  Tooltip,
  AccentLine,
  HintTip,
  PageHint,
  useToast,
  type Column,
} from '@salesos/ui';
import {
  CalendarClock,
  Download,
  Inbox,
  Phone,
  PhoneCall,
  Plus,
  StickyNote,
  UserCheck,
} from 'lucide-react';
import { Hint, PageHintView } from '@/features/hints/hint-views';
import { HintsProvider, useHints } from '@/features/hints/hints-provider';

interface Row {
  id: string;
  name: string;
  stage: string;
  owner: string;
  status: 'success' | 'warning' | 'danger' | 'overdue' | 'info';
}

const ROWS: Row[] = [
  { id: '1', name: 'Sample lead A', stage: 'Contacted', owner: 'Owner One', status: 'success' },
  { id: '2', name: 'Sample lead B', stage: 'Qualified', owner: 'Owner Two', status: 'overdue' },
  { id: '3', name: 'Sample lead C', stage: 'New', owner: 'Owner One', status: 'info' },
];

const CHART = [
  { month: 'Jan', calls: 120, connected: 54 },
  { month: 'Feb', calls: 150, connected: 71 },
  { month: 'Mar', calls: 138, connected: 66 },
  { month: 'Apr', calls: 176, connected: 92 },
];

function Section({
  id,
  title,
  children,
  note,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-24 border-t border-line py-10"
    >
      <h2 id={`${id}-h`} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      {note && <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">{note}</p>}
      <div className={note ? '' : 'mt-6'}>{children}</div>
    </section>
  );
}

/** Live value of a CSS variable for the active theme (the swatch hex differs between light and dark). */
function LiveHex({ cssVar, fallback }: { cssVar: string; fallback: string }) {
  const { resolved } = useTheme();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    if (ref.current) ref.current.textContent = v || fallback;
  }, [cssVar, fallback, resolved]);
  return <span ref={ref}>{fallback}</span>;
}

const SWATCHES: Array<[string, string, string]> = [
  ['Canvas', '--ivory-100', '#f8f3e8'],
  ['Surface', '--ivory-50', '#fffdf8'],
  ['Sunken', '--ivory-200', '#f0e8d6'],
  ['Champagne', '--champagne-200', '#efdcb2'],
  ['Ink', '--ink-900', '#1d1a16'],
  ['Muted ink', '--ink-500', '#6a6358'],
  ['Gold 400', '--gold-400', '#cca84f'],
  ['Gold 500', '--gold-500', '#b8923a'],
  ['Gold 700 (text)', '--gold-700', '#765b17'],
  ['Red 600 (errors)', '--red-600', '#b3261e'],
  ['Blue 400', '--blue-400', '#5f95e0'],
  ['Blue 600', '--blue-600', '#1f5fbf'],
  ['Blue 700 (text)', '--blue-700', '#184a94'],
  ['Green 400', '--green-400', '#4fa575'],
  ['Green 600', '--green-600', '#2d6a4c'],
  ['Green 700 (text)', '--green-700', '#22533b'],
];

function HintsDemo() {
  const hints = useHints();
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm text-muted">
        Live catalogue card for the leads page ({hints.enabled ? 'hints on' : 'hints off'}):
      </p>
      <PageHintView id="crmLeads" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={hints.toggle}>
          {hints.enabled ? 'Turn hints off' : 'Turn hints on'}
        </Button>
        <Button size="sm" variant="ghost" onClick={hints.reset}>
          Reset hints
        </Button>
      </div>
    </div>
  );
}

export function StyleGuide() {
  const { toast } = useToast();
  const [tableState, setTableState] = React.useState<'data' | 'loading' | 'empty' | 'error'>(
    'data',
  );
  const [stage, setStage] = React.useState('contacted');
  const [combo, setCombo] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(2);
  const [search, setSearch] = React.useState('');
  const [sw, setSw] = React.useState(true);

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Lead',
      primary: true,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    { id: 'stage', header: 'Stage', cell: (r) => r.stage },
    { id: 'owner', header: 'Owner', cell: (r) => r.owner },
    {
      id: 'status',
      header: 'Follow-up',
      cell: (r) => {
        const label = {
          success: 'On track',
          warning: 'Due soon',
          danger: 'Failed',
          overdue: 'Overdue',
          info: 'New',
        }[r.status];
        return <StatusBadge status={r.status}>{label}</StatusBadge>;
      },
    },
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <p className="font-display text-lg font-semibold">
            SalesOS <span className="text-muted">style guide</span>
          </p>
          <nav
            aria-label="Sections"
            className="flex max-w-full gap-1 overflow-x-auto text-sm [scrollbar-width:none]"
          >
            {[
              'tokens',
              'buttons',
              'forms',
              'badges',
              'surfaces',
              'data',
              'hints',
              'overlays',
              'states',
              'charts',
              'activity',
            ].map((s) => (
              <a
                key={s}
                href={`#${s}`}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-ink-700 capitalize hover:bg-ivory-200"
              >
                {s}
              </a>
            ))}
          </nav>
        </div>
        <AccentLine className="h-px" />
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
        <div className="pt-10">
          <PageHeader
            eyebrow="Design system"
            title="Light and dark components"
            description="Every component and state used across SalesOS. Warm charcoal on champagne ivory; gold for premium emphasis, blue for information and active workflow, green for success and money-in, red for risk only."
            breadcrumbs={[{ label: 'Dev', href: '/dev/style-guide' }, { label: 'Style guide' }]}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <ThemeSegmented />
                <Button
                  variant="secondary"
                  leadingIcon={<Download className="size-4" aria-hidden="true" />}
                >
                  Export tokens
                </Button>
              </div>
            }
          />
        </div>

        <Section
          id="tokens"
          title="Tokens"
          note="Colour, type, radius, shadow, focus and motion are CSS variables in packages/ui/src/styles/tokens.css."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SWATCHES.map(([name, v, hex]) => (
              <li key={v} className="overflow-hidden rounded-lg border border-line bg-surface">
                <div className="h-14 border-b border-line" style={{ background: `var(${v})` }} />
                <div className="p-2.5">
                  <p className="text-[0.8125rem] font-medium">{name}</p>
                  <p className="font-mono text-xs text-muted"><LiveHex cssVar={v} fallback={hex} /></p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <p className="font-display text-4xl font-semibold tracking-tight">Display Fraunces</p>
              <p className="font-display text-2xl font-semibold">Heading two, serif</p>
              <p className="text-base">
                Body text in Inter at 15px: Every active lead has a responsible owner and a clear
                next action.
              </p>
              <p className="text-sm text-muted">
                Secondary text uses muted ink, which still meets AA contrast on ivory.
              </p>
              <p className="tabular font-display text-3xl">₹ 12,48,000 &nbsp;·&nbsp; 1,234</p>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {(['sm', 'md', 'lg', 'xl'] as const).map((r) => (
                <div
                  key={r}
                  className={`flex h-20 items-center justify-center border border-line-strong bg-surface text-xs shadow-md rounded-${r}`}
                >
                  {r}
                </div>
              ))}
              <div className="col-span-4 space-y-3 pt-2">
                <AccentLine tone="gold" />
                <AccentLine tone="blue" />
                <AccentLine tone="green" />
                <AccentLine tone="tricolor" />
                <AccentLine tone="red" animated={false} />
                <p className="text-xs text-muted">
                  Accent lines draw in once, then a light travels along them every few seconds
                  (gold, blue, green, tricolor; red is static, errors only). CSS: .accent-line
                  .accent-line-gold|blue|green. Reduced motion renders them static.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="buttons"
          title="Buttons"
          note="Clear hierarchy, 44px touch targets on mobile, visible focus, loading and disabled states."
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary (gold sheen)</Button>
              <Button variant="blue">Blue</Button>
              <Button variant="green">Green</Button>
              <Button variant="charcoal">Charcoal</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add" variant="secondary">
                <Plus className="size-5" aria-hidden="true" />
              </Button>
              <Button leadingIcon={<PhoneCall className="size-4" aria-hidden="true" />}>
                Log a call
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading>Saving</Button>
              <Button variant="secondary" loading>
                Loading
              </Button>
              <Button disabled>Disabled</Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
            </div>
          </div>
        </Section>

        <Section
          id="forms"
          title="Form controls"
          note="Labels always visible, errors associated with aria-describedby, required marked for sighted and screen-reader users."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <FormField label="Full name" hint="As it appears on the invoice" required>
              <Input placeholder="Aarav Sharma" />
            </FormField>
            <FormField label="Email" error="Enter a valid email address" required>
              <Input defaultValue="not-an-email" type="email" />
            </FormField>
            <FormField label="Disabled">
              <Input disabled defaultValue="Read only value" />
            </FormField>
            <FormField label="Stage">
              <Select defaultValue="contacted">
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
              </Select>
            </FormField>
            <FormField label="Owner (combobox)" hint="Type to filter, arrow keys to move">
              <Combobox
                value={combo}
                onValueChange={setCombo}
                options={[
                  { value: 'a', label: 'Owner One', description: 'owner.one@example.com' },
                  { value: 'b', label: 'Owner Two', description: 'owner.two@example.com' },
                  { value: 'c', label: 'Owner Three', description: 'owner.three@example.com' },
                ]}
              />
            </FormField>
            <FormField label="Callback date">
              <DatePicker defaultValue="2026-10-20" />
            </FormField>
            <FormField label="Call notes" className="md:col-span-2">
              <Textarea placeholder="What did the client say?" />
            </FormField>
            <div className="space-y-1">
              <Checkbox
                label="Send WhatsApp follow-up"
                description="Requires client consent"
                defaultChecked
              />
              <Checkbox label="Mark as high priority" />
              <Checkbox label="Disabled option" disabled />
            </div>
            <div>
              <Switch
                label="Email reminders"
                description="Daily digest at 9:00"
                checked={sw}
                onCheckedChange={setSw}
              />
              <Switch label="Disabled switch" disabled />
            </div>
          </div>
        </Section>

        <Section
          id="badges"
          title="Badges and status"
          note="Status is always icon + text, never colour alone."
        >
          <div className="flex flex-wrap gap-2.5">
            <StatusBadge status="success">Won</StatusBadge>
            <StatusBadge status="warning">Due soon</StatusBadge>
            <StatusBadge status="overdue">Overdue</StatusBadge>
            <StatusBadge status="danger">Lost</StatusBadge>
            <StatusBadge status="info">New lead</StatusBadge>
            <StatusBadge status="pending">Awaiting approval</StatusBadge>
            <StatusBadge status="neutral">Inactive</StatusBadge>
            <Badge tone="gold">Premium</Badge>
            <Badge>Neutral</Badge>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <Avatar name="Aarav Sharma" size="sm" />
            <Avatar name="Priya Nair" />
            <Avatar name="Rohan Deshmukh" size="lg" />
            <Tooltip label="Tooltips explain icon-only controls">
              <Button size="icon" variant="secondary" aria-label="Call">
                <Phone className="size-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
          <div className="mt-6">
            <Breadcrumbs
              items={[
                { label: 'Admin', href: '#' },
                { label: 'Users', href: '#' },
                { label: 'Aarav Sharma' },
              ]}
            />
          </div>
        </Section>

        <Section id="surfaces" title="Cards, panels and KPI tiles">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Follow-up compliance"
              value="—"
              hint="No data yet"
              accent="gold"
              icon={<UserCheck />}
            />
            <Stat label="Collections this month" value="₹ 4,82,000" delta="12%" trend="up" accent="green" />
            <Stat
              label="Overdue tasks"
              value="12"
              delta="3"
              trend="down"
              deltaLabel="more than last week"
              accent="red"
            />
            <Stat label="Connected calls" value="248" delta="8%" trend="up" accent="blue" />
            <Stat label="Loading tile" value="" loading />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel
              title="Panel with header"
              description="Consistent header, body and footer rhythm"
              actions={
                <Button size="sm" variant="secondary">
                  Action
                </Button>
              }
              footer={<span className="text-sm text-muted">Footer note</span>}
            >
              <SkeletonText lines={3} />
            </Panel>
            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-1 lg:grid-cols-1">
              <Card accent="gold" premium interactive>
                <p className="font-display text-lg font-semibold">Gold premium card</p>
                <p className="mt-1 text-sm text-muted">
                  Animated top rule, layered shadow, lifts on hover.
                </p>
              </Card>
              <Card accent="blue" interactive>
                <p className="font-display text-lg font-semibold">Blue workflow card</p>
              </Card>
              <Card accent="green" interactive>
                <p className="font-display text-lg font-semibold">Green growth card</p>
              </Card>
            </div>
          </div>
          <div className="mt-6 stagger grid gap-4 sm:grid-cols-3">
            {(['gold', 'blue', 'green'] as const).map((t) => (
              <div key={t} className={`panel-premium accent-top tone-${t} hover-lift p-5`}>
                <span className="accent-top-sheen" aria-hidden="true" />
                <p className="text-xs font-semibold tracking-[0.14em] text-[var(--tone-text)] uppercase">
                  .panel-premium .accent-top .tone-{t}
                </p>
                <p className="kpi-number mt-3 text-3xl">{t === 'green' ? '₹ 9,40,000' : '1,284'}</p>
                <p className="link-underline mt-3 inline-block text-sm text-ink-700" data-active="true">
                  .link-underline
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <Tabs defaultValue="one">
              <TabsList aria-label="Example tabs">
                <TabsTrigger value="one">Overview</TabsTrigger>
                <TabsTrigger value="two">Activity</TabsTrigger>
                <TabsTrigger value="three">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="one" className="text-sm text-ink-700">
                The animated gold underline marks the selected tab; keyboard arrows move between tabs.
              </TabsContent>
              <TabsContent value="two" className="text-sm text-ink-700">
                Activity content.
              </TabsContent>
              <TabsContent value="three" className="text-sm text-ink-700">
                Settings content.
              </TabsContent>
            </Tabs>
          </div>
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium">Pipeline stage chips</p>
            <StageChips
              value={stage}
              onChange={setStage}
              stages={[
                { id: 'new', label: 'New', count: 14 },
                { id: 'contacted', label: 'Contacted', count: 9 },
                { id: 'qualified', label: 'Qualified', count: 5 },
                { id: 'demo', label: 'Demo booked' },
                { id: 'won', label: 'Won' },
              ]}
            />
          </div>
        </Section>

        <Section
          id="data"
          title="Data table, filters and pagination"
          note="Desktop renders a semantic table; below 768px the same rows render as cards."
        >
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Table state">
            {(['data', 'loading', 'empty', 'error'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={tableState === s ? 'primary' : 'secondary'}
                aria-pressed={tableState === s}
                onClick={() => setTableState(s)}
                className="capitalize"
              >
                {s}
              </Button>
            ))}
          </div>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search leads"
            searchPlaceholder="Search leads…"
            activeCount={search ? 1 : 0}
            onClear={() => setSearch('')}
          >
            <div className="w-full sm:w-44">
              <FormField label="Owner" hideLabel>
                <Select>
                  <option>All owners</option>
                  <option>Owner One</option>
                </Select>
              </FormField>
            </div>
          </FilterBar>
          <DataTable
            caption="Sample leads"
            columns={columns}
            rows={tableState === 'empty' ? [] : ROWS}
            getRowId={(r) => r.id}
            loading={tableState === 'loading'}
            error={
              tableState === 'error'
                ? { message: 'Leads could not be loaded.', onRetry: () => setTableState('data') }
                : null
            }
            emptyTitle="No leads match"
            emptyDescription="Adjust the filters or add a lead."
            emptyAction={
              <Button size="sm" leadingIcon={<Plus className="size-4" aria-hidden="true" />}>
                Add lead
              </Button>
            }
            rowActions={() => (
              <Button size="sm" variant="ghost">
                Open
              </Button>
            )}
          />
          <Pagination
            className="mt-4"
            page={page}
            pageCount={6}
            total={118}
            pageSize={20}
            onPageChange={setPage}
          />
        </Section>

        <Section
          id="hints"
          title="Hints"
          note="HintTip is a small ? button that opens a popover (Enter or Space opens, Esc closes, works on touch). PageHint is a dismissible, collapsible card under a page header. The user can turn all hints off from the lightbulb in the top bar."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                Static HintTip
                <HintTip title="Next action" learnMoreHref="#hints" learnMoreLabel="Learn more">
                  <p>Every active lead needs an owner and a dated next action.</p>
                </HintTip>
              </p>
              <FormField
                label="Field with a hint"
                info={
                  <HintTip title="Transaction reference">
                    <p>Enter the UTR or gateway reference. It cannot be recorded twice.</p>
                  </HintTip>
                }
              >
                <Input placeholder="UTR" />
              </FormField>
              <p className="flex items-center gap-1.5 text-sm text-muted">
                Catalogue hint (translated, respects the on/off switch):
                <Hint id="dealClosedWon" />
              </p>
            </Card>
            <div>
              <PageHint
                className="mt-0"
                labels={{
                  title: 'About this page',
                  whatLabel: 'What this is',
                  firstLabel: 'Do this first',
                  tipLabel: 'Good to know',
                  collapse: 'Collapse page tips',
                  expand: 'Expand page tips',
                  dismiss: 'Hide these tips for this page',
                  restore: 'Show page tips',
                }}
                what="Static example of a page hint card."
                first="Read the one-line summary, then start with the first step."
                tip="Hints never store private data; only which ones you hid."
                onDismiss={() => undefined}
              />
              <HintsProvider userId="style-guide">
                <HintsDemo />
              </HintsProvider>
            </div>
          </div>
        </Section>

        <Section id="overlays" title="Dialog, sheet, drawer and toast">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent
                title="Reassign lead"
                description="Choose a new owner. This is recorded in the audit log."
                footer={
                  <>
                    <Button variant="secondary">Cancel</Button>
                    <Button>Reassign</Button>
                  </>
                }
              >
                <FormField label="New owner">
                  <Select>
                    <option>Owner One</option>
                    <option>Owner Two</option>
                  </Select>
                </FormField>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open side sheet</Button>
              </SheetTrigger>
              <SheetContent
                title="Lead details"
                description="Right sheet on desktop"
                footer={<Button>Save</Button>}
              >
                <SkeletonText lines={5} />
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open bottom drawer</Button>
              </SheetTrigger>
              <SheetContent side="bottom" title="Quick actions">
                <p className="text-sm text-muted">Bottom drawer for mobile-first quick actions.</p>
              </SheetContent>
            </Sheet>
            <Button
              variant="secondary"
              onClick={() =>
                toast({
                  tone: 'success',
                  title: 'Follow-up scheduled',
                  description: 'Callback set for tomorrow, 11:00.',
                })
              }
            >
              Success toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast({ tone: 'info', title: 'Syncing in the background' })}
            >
              Info toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast({
                  tone: 'warning',
                  title: 'Team above soft limit',
                  description: 'Six executives for one manager.',
                })
              }
            >
              Warning toast
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast({
                  tone: 'danger',
                  title: 'Could not save',
                  description: 'You appear to be offline. Nothing was saved.',
                })
              }
            >
              Error toast
            </Button>
          </div>
        </Section>

        <Section
          id="states"
          title="States"
          note="Every screen covers loading, empty, error, success and permission denied."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Card padded={false}>
              <LoadingRegion label="Loading leads" className="space-y-3 p-5">
                <Skeleton className="h-6 w-1/2" />
                <SkeletonText lines={3} />
                <Skeleton className="h-24 w-full" />
              </LoadingRegion>
            </Card>
            <Card padded={false}>
              <EmptyState
                icon={<Inbox />}
                title="No tasks due today"
                description="You are all caught up. New follow-ups will appear here."
                action={<Button size="sm">Create task</Button>}
              />
            </Card>
            <Card padded={false}>
              <ErrorState
                requestId="req_8f3a21c9"
                onRetry={() => toast({ tone: 'info', title: 'Retrying…' })}
              />
            </Card>
            <Card padded={false}>
              <PermissionDenied />
            </Card>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Alert tone="success" title="Saved">
              Call logged and next task scheduled.
            </Alert>
            <Alert tone="info" title="Heads up">
              Imports run in the background.
            </Alert>
            <Alert tone="warning" title="Offline">
              You are offline. Changes cannot be saved right now.
            </Alert>
            <Alert tone="danger" title="Failed">
              The request did not go through. Nothing was saved.
            </Alert>
          </div>
        </Section>

        <Section
          id="charts"
          title="Chart wrapper"
          note="Every chart carries a text summary and a toggle to an accessible table. Series differ by line pattern as well as colour."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Calls by month"
              summary="Calls rose from 120 in January to 176 in April; connected calls rose from 54 to 92."
              data={CHART}
              xKey="month"
              series={[
                { key: 'calls', label: 'Calls', tone: 'blue' },
                { key: 'connected', label: 'Connected', tone: 'gold' },
              ]}
            />
            <ChartCard
              kind="line"
              title="Connected calls trend"
              summary="Connected calls climbed over four months, peaking in April."
              data={CHART}
              xKey="month"
              series={[
                { key: 'connected', label: 'Connected', tone: 'blue' },
                { key: 'calls', label: 'All calls', tone: 'ink' },
              ]}
            />
          </div>
        </Section>

        <Section
          id="glow-motion"
          title="Glow + motion v2"
          note="Soft warm glows and entrance utilities. All animation is disabled under prefers-reduced-motion."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['glow-gold', 'Gold glow'],
              ['glow-blue', 'Blue glow'],
              ['glow-green', 'Green glow'],
              ['glow-hover', 'Glow on hover (hover me)'],
              ['glow-pulse', 'Glow pulse (one per page)'],
              ['border-glow', 'Border glow'],
            ].map(([cls, label]) => (
              <div
                key={cls}
                tabIndex={0}
                className={`${cls} rounded-xl border border-line bg-surface p-5`}
              >
                <p className="font-mono text-xs text-muted">.{cls}</p>
                <p className="mt-1 font-medium text-ink">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ['enter-up', 'Rises in'],
              ['enter-fade', 'Fades in'],
              ['enter-scale', 'Scales in'],
            ].map(([cls, label]) => (
              <div key={cls} className={`${cls} rounded-xl border border-line bg-surface p-5`}>
                <p className="font-mono text-xs text-muted">.{cls}</p>
                <p className="mt-1 font-medium text-ink">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 max-w-md space-y-2" aria-hidden="true">
            <div className="shimmer h-4 w-3/4 rounded bg-sunken" />
            <div className="shimmer h-4 w-1/2 rounded bg-sunken" />
            <p className="font-mono text-xs text-muted">.shimmer (loading placeholder)</p>
          </div>
        </Section>

        <Section id="activity" title="Timeline">
          <Card className="max-w-2xl">
            <Timeline
              label="Lead activity"
              items={[
                {
                  id: '1',
                  title: 'Call connected',
                  description: 'Interested in the leadership programme; asked for fees.',
                  time: '2 min ago',
                  icon: <PhoneCall />,
                  tone: 'blue',
                },
                {
                  id: '2',
                  title: 'Callback scheduled',
                  description: 'Tomorrow, 11:00',
                  time: '1 h ago',
                  icon: <CalendarClock />,
                  tone: 'gold',
                },
                {
                  id: '3',
                  title: 'Note added',
                  description: 'Prefers WhatsApp for documents.',
                  time: 'Yesterday',
                  icon: <StickyNote />,
                },
                { id: '4', title: 'Task overdue', time: '2 days ago', tone: 'red' },
              ]}
            />
          </Card>
        </Section>
      </main>
    </div>
  );
}
