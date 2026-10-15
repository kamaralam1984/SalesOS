# Phase 1-2 Frontend Report and Developer Guide (Agent C)

Scope: `apps/web` (Next.js 16 App Router) and `packages/ui` (design system). Backend contract: `docs/phase-1-2-backend-report.md`, `docs/api-catalogue.md`.

## 1. What exists

- **Design system** `@salesos/ui` (source-only package, transpiled by Next): tokens, 40+ components. See `docs/ux-design-system.md` sections 10-13. Live demo: `/dev/style-guide`.
- **App shell** (`apps/web/src/components/shell`): desktop sidebar, mobile bottom nav + "More" sheet, top bar (language switch, notification bell placeholder, account menu), offline banner, skip link, idle-logout dialog.
- **Auth** (`apps/web/src/features/auth`): login, forgot password, reset password, invite accept, `AuthProvider` (`/auth/me` bootstrap, global 401 handling), `usePermission()`, `<Can>`, `<RequirePermission>`, role-based landing, idle logout warning.
- **Admin** (`apps/web/src/features/admin`): users (list/search/filter/paginate, invite, edit, role assignment, deactivate/reactivate), teams (list, create, detail with members and soft-limit warning), organisation settings, audit log viewer (filters + pagination + detail), roles/permissions catalogue (read-only).
- **Role dashboards**: `/dashboard/{founder,team-lead,manager,executive,admin}` show an honest EmptyState until Phase 5. No numbers.
- **Module placeholders**: `/crm /revenue /people /sop /cx /collaboration /reporting /notifications` render "arrives in Phase N" via `ModulePlaceholder`.
- **PWA**: `app/manifest.ts`, generated icons (`scripts/generate-icons.mjs`), `public/sw.js`, `public/offline.html`.
- **i18n**: `next-intl`, cookie-based (`NEXT_LOCALE`, no URL prefix). `messages/{en,hi,mr}.json` fully translated for shell, auth, admin, errors, validation, roles.
- **Security**: nonce-based CSP in `src/proxy.ts` (Next 16 replaces `middleware.ts`), static headers in `next.config.ts`, coarse session-cookie route guard, no secrets in the bundle (only `NEXT_PUBLIC_API_URL`).

## 2. How to add things (for later agents)

### 2.1 A new page in your domain
1. Create `apps/web/src/app/(app)/<domain>/.../page.tsx`. Keep it thin; put the UI in `apps/web/src/features/<domain>/`.
2. Wrap content with `<RequirePermission permission="leads:view" minScope="own">` (UI hiding only; the API enforces).
3. Use `<PageHeader>` as the first element (one `h1` per page), then `Panel`/`DataTable`/etc.
4. Replace the placeholder `page.tsx` that renders `ModulePlaceholder`; delete the `comingInPhase` field from your nav entry.

### 2.2 A nav entry
Edit ONLY your `apps/web/src/nav/<domain>.ts`. Each item: `id` (unique), `labelKey` (key under `nav` in all three message files), `href`, `icon` (lucide), `permission` (`'a:b'`, `['a:b','c:d']` any-of, or `null`), optional `minScope` (`'team'` hides it from own-scope roles), `mobilePriority` (1-4 = bottom bar candidate, `null` = sidebar/More only), `order`, optional `children`. `registry.ts` aggregates; do not edit it unless adding a domain file.
Permission keys must be the real catalogue keys (`apps/api/src/common/authz/permissions/*.ts`), e.g. `users:view`, `teams:view`, `settings:view`, `audit:view`, `users:role:assign`.

### 2.3 API hooks
Pattern: one file per resource in `apps/web/src/lib/api/hooks/<resource>.ts`, exported through `lib/api/index.ts`.
```ts
export function useLeads(q: LeadsQuery) {
  return useQuery({
    queryKey: qk.leads.list(q),            // add a namespace to lib/api/keys.ts
    placeholderData: keepPreviousData,
    queryFn: async () => { const r = await api.get<Lead[]>('/leads', q); return { items: r.data, pagination: r.meta.pagination }; },
  });
}
```
Mutations use `api.post/patch/put/delete`, invalidate the namespace in `onSuccess`, and never claim success on failure. `api` returns `{ data, meta }` (meta has `pagination`, `warnings`, `requestId`) and throws `ApiError` (`status`, `code`, `message`, `details`, `requestId`, `fieldErrors`). Everything about the contract (base URL, CSRF header, bootstrap path, envelope) lives in `lib/api/client.ts`. Types mirror `@salesos/shared-types` in `lib/api/types.ts`; add your wire types there or next to your hook.
Pagination: the API returns `meta.pagination` (`hasMore`, `page`, `nextCursor`). Request with `page=N` and use `<Pagination page hasNext>`; `total` is not provided by the API today.

### 2.4 Forms
React Hook Form + Zod (`zodResolver`). Schema messages are i18n KEYS in the `validation` namespace (`z.string().min(1, 'required')`); render with `useFieldError()`:
```tsx
const fe = useFieldError();
<FormField label={t('name')} error={fe(form.formState.errors.name)} required><Input {...form.register('name')} /></FormField>
```
Submit buttons use `loading`. Catch `ApiError` and show `useApiErrorMessage()(e).message` in an `<Alert tone="danger">` or toast; map `e.fieldErrors` to `form.setError`. Offline is handled by the client (throws `OFFLINE`, nothing is sent). Dialog/Sheet forms: mount the form body only while open (`{open && <Body/>}`) so state resets without effects; this satisfies the strict `react-hooks` lint rules.

### 2.5 Components
Add generic components to `packages/ui/src/components/*.tsx` and export from `src/index.ts`; domain-specific components stay in `apps/web/src/features/<domain>/`. Every data component needs the five states (loading/empty/error/success/permission-denied) and must appear on `/dev/style-guide`. UI components take translated strings as props (no next-intl inside `packages/ui`) with English defaults.

### 2.6 Strings
Add keys to all three `messages/*.json` (a vitest test fails if key sets or ICU placeholders differ). Use ICU plurals, never concatenate sentences. Format dates with `Intl` in the org timezone (`useDateTimeFormat`).

## 3. UI conventions
- One `h1` per page via `PageHeader`; eyebrow = section name; accent line is part of the header.
- Gold = emphasis/selection; red = risk, error, overdue only; blue = links, info, data, focus. Status = icon + text.
- Tables use `DataTable` (cards on mobile). Row actions go in `rowActions`.
- Destructive actions use a confirm `Dialog` with `variant="danger"`, explain consequences, and audit-sensitive actions mention the audit log.
- Never render mock data as real. Placeholders say what is missing and in which phase it arrives.
- UI permission checks are cosmetic. Use `minScope` so own-scope grants (e.g. executives hold `users:view` at `own`) do not open admin screens.

## 4. Environment

| Variable | Where | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | build-time, public | `http://localhost:4100/api/v1` |
| `SESSION_COOKIE_NAME` | proxy (server) | `salesos_session` |
| `ENABLE_STYLE_GUIDE` | server | unset (style guide 404s in production) |
| `PORT` | dev/start | `3100` |

Use `localhost` for both web and API (not `127.0.0.1` for one and `localhost` for the other): the session cookie is `SameSite=Lax` and the API's CORS origin defaults to `http://localhost:3100`.

## 5. Commands and real results (run on this machine)

| Command | Result |
|---|---|
| `pnpm --filter @salesos/ui typecheck` / `lint` | pass / pass |
| `pnpm --filter @salesos/web typecheck` / `lint` | pass / pass |
| `pnpm --filter @salesos/web test` (Vitest + Testing Library + vitest-axe) | 9 files, 63 tests passed |
| `pnpm --filter @salesos/web build` | pass (29 routes) |
| `pnpm --filter @salesos/web e2e` (Playwright, real API on :4103 + DB `salesos_agentc`, web prod build on :3103) | 20 passed, 0 failed (20 screenshot-capture tests skipped unless `SHOTS_DIR` is set) |

E2E specs: `auth.spec.ts` (guards, login errors, validation, role landing, logout, server-side session revoke -> expired notice, offline, language switch), `admin.spec.ts` (invite/edit/roles/deactivate/reactivate user, create team + add member, org settings persist, audit filter, roles catalogue), `a11y.spec.ts` (axe WCAG A/AA on login, forgot-password, style guide, dashboard, users, teams, settings), `security.spec.ts` (CSP/headers with no violations while using the app, SW + manifest served). `screenshots.spec.ts` captures 375/768/1280/1920 PNGs to `SHOTS_DIR` (outside the repo) for visual review.

Run E2E locally:
```
# API (built with `pnpm --filter @salesos/api build`) on 4103 against your own DB, CORS_ORIGINS=http://localhost:3103
NEXT_PUBLIC_API_URL=http://localhost:4103/api/v1 pnpm --filter @salesos/web build
ENABLE_STYLE_GUIDE=true PORT=3103 pnpm --filter @salesos/web start
pnpm --filter @salesos/web e2e
```
E2E uses the seeded demo users (`Demo!<local>#2026`, e.g. `admin@demo.salesos.local`); run the API seed on your DB first.

## 6. Known issues / follow-ups

- **API permission-key inconsistency (RESOLVED by the integration pass)**: the controllers, catalogue and UI now all use `teams:view|create|update|delete` only; the legacy `teams:read`/`teams:manage` spellings were removed (no remaining usages).
- API has no `GET /teams/:id`; team detail is derived from the list + `/teams/:id/members`. The list `memberCount` includes the lead; the UI subtracts the lead when comparing with the soft limit.
- `POST /users/:id/roles` (not PUT) is used for role assignment, matching the controller.
- List endpoints do not return `total`; pagination shows "Page N" with Previous/Next.
- Invite emails are not sent by Phase 2 (token issued by API); the UI says "invite sent" per the API response. Confirm delivery behaviour when notifications land (Phase 8).
- Hindi/Marathi strings are first-pass translations; recommend native-speaker review before launch.
- Not done / out of scope here: Lighthouse PWA audit, screen-reader manual testing, dark mode (optional), visual-regression baseline.
- Next.js writes `AGENTS.md`/`CLAUDE.md` into `apps/web` on `next dev`; they are generated and can be deleted.
