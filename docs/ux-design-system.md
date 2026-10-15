# UX Design System (Phase 0 spec; implemented in `packages/ui` Phase 1)

Date: 2026-10-14. Direction: premium light-luxury business interface; human-designed feel, not a generic AI template. Restraint over decoration.

## 1. Tokens (proposed starting values; tune with contrast checks)
| Token | Value | Use |
|---|---|---|
| `--bg` | #FBF8F2 (ivory) | app background |
| `--surface` | #FFFFFF | cards/panels |
| `--surface-2` | #F5F1E8 | subtle wells, table zebra |
| `--border` | #E6DFD0 | hairlines |
| `--text` | #1C1B19 (warm charcoal) | primary text (contrast >= 12:1 on bg) |
| `--text-muted` | #5E5A52 | secondary (>= 4.5:1) |
| `--gold-500` | #B8892B | premium emphasis, milestones, selected underline (never body text on ivory below 3:1 large only) |
| `--gold-100` | #F6EBD0 | gold tint backgrounds |
| `--red-600` | #B3261E | errors, overdue, risk, negative variance |
| `--red-100` | #FBE9E7 | red tint |
| `--blue-600` | #1F5FBF | links, info, active workflow, chart primary |
| `--blue-100` | #E7EFFB | blue tint |
| `--success` | #2E7D4F | confirmations (paired with icon+text) |
| Focus ring | 2px `--blue-600` + 2px offset white | all interactive |
Dark mode: implemented (section 16): tokens redefined, not inverted.
Spacing scale 4px (4,8,12,16,24,32,48,64); radii 6/10/16; shadows 3 levels, soft low-opacity warm; type: Inter (UI) with Noto Sans Devanagari fallback for Hindi/Marathi, scale 12/14/16/18/20/24/32, line-height 1.5 body; tabular numerals for money/KPIs; INR formatting `en-IN` lakh/crore grouping.

## 2. Accent rules
- **Gold:** premium emphasis only (key KPI headline, milestones, top-performer badge, selected-tab underline). Max one gold element per card.
- **Red:** errors, overdue, risk, negative variance. Never decorative. Always with text/icon (e.g. "Overdue 2d").
- **Blue:** links, info, active workflow state, data-viz primary series.
- **Green (DEC-047):** success, growth, money-in, positive deltas. Always with icon + text.
- Update (DEC-047, owner override): the palette is now gold + blue + green accents with animated accent lines; red stays errors/overdue/risk only. See section 14.
- Subtle animated accent line (1-2px) under page title/active tab, 240 ms ease-out, once per navigation. No glow, no heavy gradients, no glassmorphism, no parallax.

## 3. Components (Phase 1 list)
Button (primary/secondary/ghost/danger; sizes; loading spinner + disabled; min touch 44x44), Card/Panel, Input/Textarea/Select/Combobox/DatePicker (IST aware), Table (desktop) -> cards (mobile), Dialog/Sheet (bottom sheet on mobile), Toast, Tabs, EmptyState, ErrorState (retry), PermissionDenied state, Skeleton (only where helpful), StatusBadge (icon + label + colour; never colour alone), KpiCard (value, delta, definition tooltip, freshness, dash for null), ChartFrame (title, summary sentence, accessible data table toggle), Stepper (state machines), Timeline, ConfirmDialog (destructive), OfflineBanner, LanguageSwitcher.
Every data component implements 5 states: loading, empty, error, success, permission-denied; demonstrated on `/style-guide`.

## 4. Motion
Durations 120/200/320 ms; easing `cubic-bezier(0.2,0.8,0.2,1)`; transitions for state, not decoration; Framer Motion wrappers read `prefers-reduced-motion` and switch to opacity-only or none; no information conveyed only by motion; nothing flashes > 3 Hz.

## 5. Layout and navigation
- Mobile (<768): bottom nav, max 5 primary destinations per role (Executive: Today, Leads, Tasks, Calendar, More; Manager: Team, Leads, Queue, Reports, More; Founder/TL: Dashboard, Pipeline, Team, Reports, More). Sticky top bar with search; FAB for "Log call" on lead detail only. One-hand follow-up flow: lead card -> tap-to-call (`tel:`) -> disposition sheet within thumb zone -> next-action quick picks (+3h, tomorrow 10:00, custom).
- Tablet: collapsible rail. Laptop/desktop: left sidebar 248px, content max-width 1280px, optional right context panel.
- Tables on mobile become stacked cards with the 3 most important fields; horizontal scroll only for wide reports with sticky first column.
- Breakpoints: 360, 768, 1024, 1280, 1920 tested.
- Nav is permission-aware from `/auth/me`; hiding is cosmetic only.

## 6. Content and i18n
English first; all strings through message catalogues (`en`, `hi`, `mr`); no concatenated sentences; plural/ICU; dates `DD MMM YYYY`, times 12h with IST label; numbers lakh/crore grouping for INR. Program names/ranks come from configuration. Text expansion tolerance 30% (Marathi/Hindi).

## 7. Accessibility (WCAG 2.2 AA target)
Semantic landmarks and headings; keyboard-complete; visible focus; labels and error association (`aria-describedby`); status announcements via `aria-live=polite`; contrast checks in CI on tokens; touch targets >= 44px; charts have text summary + table; no colour-only status; zoom to 200% without loss; reduced motion honoured; axe checks in Playwright. Screen-reader spot checks before launch.

## 8. Honesty in UI
`[DEMO]` banner when running on seed data; AI output labelled "AI suggestion - review before use"; estimates labelled (forecasts); calls labelled MANUAL / VERIFIED; queued is never shown as delivered; offline shows "nothing was saved".

## 9. Do / do not
Do: generous whitespace, clear hierarchy, one primary action per view. Do not: gradient backgrounds, glow, random motion, more than three accent colours, status by colour alone.

---

# Implementation notes (Phase 1-2 frontend, Agent C)

Where the Phase 0 proposal above and the implementation differ, the implementation (`packages/ui/src/styles/tokens.css`) is authoritative.

## 10. Implemented tokens (differences from section 1)
- Surfaces: canvas `#fbf8f2`, surface `#fffefb`, sunken `#f4efe4`, hairline `#e7e0d2` / strong `#d3c9b5`. Ink scale 950-400 (`--ink-900 #1d1a16`; muted `--ink-500 #6a6358`, AA on ivory).
- Gold text uses `--gold-700 #765b17` (AA); `--gold-500 #b8923a` is for rules, rings and fills only. Red 600 `#b3261e`, Blue 600 `#1f5fbf`, success green 600 `#2d6a4c` (always icon + text).
- Fonts are self-hosted via `@fontsource-variable`: Inter (UI) and Fraunces (display headings, KPI numerals). No Google Fonts request, so CSP `font-src 'self'` holds. Devanagari falls back to system Noto Sans Devanagari.
- Radii 6/10/14/20, 4 warm low-opacity shadows, motion 120/200/380 ms with `cubic-bezier(0.2,0.7,0.2,1)`; all animation is neutralised under `prefers-reduced-motion`.
- Tokens are exposed twice: CSS variables (`--gold-500`) and Tailwind v4 theme utilities (`bg-gold-500`, `text-muted`, `border-line`, `rounded-lg`, `shadow-md`).

## 11. Component inventory (`@salesos/ui`)
Button, Spinner, Card, Panel, FormField, Input, Textarea, Select (native), Checkbox, Switch, DatePicker (native date/datetime-local), Combobox (ARIA 1.2), Badge, StatusBadge, Alert, Skeleton, SkeletonText, LoadingRegion, EmptyState, ErrorState, PermissionDenied, Dialog, Sheet (right/left/bottom), DropdownMenu, Popover, Tooltip, ToastProvider/useToast, Tabs, PageHeader, Breadcrumbs, AccentLine, Stat, Avatar, Timeline, StageChips, DataTable (table at >=768px, cards below), Pagination (page or cursor), FilterBar, ChartCard (recharts + summary + chart/table toggle).
Live demo of every component and state: `/dev/style-guide` (404 in production unless `ENABLE_STYLE_GUIDE=true`).

## 12. Rules the components enforce
- Status is never colour-only: `StatusBadge` requires text and always renders an icon; `Stat` deltas carry an arrow icon plus sr-only direction.
- `FormField` wires label, hint, error (`role="alert"`) and `aria-describedby`/`aria-invalid` into Input/Textarea/Select/DatePicker/Combobox.
- Buttons have a 44px minimum height on touch widths and set `aria-busy` + block activation while loading.
- Charts always carry a plain-language summary and a table view; series differ by dash pattern as well as colour.
- Dialogs become bottom sheets on phones.

## 13. Shell
Desktop: 264px sidebar with section labels, gold active rule, "Phase N" tag on not-yet-built modules; top bar with language switch, notification bell (placeholder, no fake count) and account menu. Mobile: bottom navigation (max 4 items by `mobilePriority` plus "More" sheet), safe-area padding, toasts lifted above the bar. Offline banner appears at the top of the shell. Skip link targets `#main`.

## 14. Luxury-premium layer (DEC-047, 2026-10-15)
**Palette:** deeper champagne-ivory surfaces (canvas `#f8f3e8`, surface `#fffdf8`, `--champagne-100/200`), warm charcoal ink, gold ramp 50-800 plus `--gold-gradient`, blue ramp 50-800 (`--blue-gradient`), green ramp 50-800 (`--green-gradient`). AA text variants: gold-700, blue-700, green-700 (use 500/600 for fills, rules and rings only). Existing token names are unchanged.
**Depth:** `--elev-1..3`, `--shadow-xs..xl`, `--shadow-gold|blue|green` (button shadows), radii up to `--radius-2xl`. Panels are opaque paper (`--panel-gradient`), no glass/blur.
**Motion tokens:** `--ease-out`, `--ease-spring`, `--ease-in-out`, `--dur-fast/base/slow/xslow`, `--stagger-step`. Every animation (and the travelling light, sheen, stagger) is disabled or collapsed under `prefers-reduced-motion`; the longest loops repeat every 6 s (far below 3 Hz).
**CSS utilities (tokens.css, `@layer components`):**
- `.accent-line` + `.accent-line-gold|blue|green|tricolor|thick`: 2px rule that draws in once, then a light travels along it.
- `.accent-top` + `.tone-gold|blue|green` on a `position:relative` panel: top rule; add child `<span class="accent-top-sheen">` for the travelling light.
- `.panel`, `.panel-premium`, `.hover-lift`, `.sheen` (sweep on hover/focus for buttons), `.stagger` (children rise in sequence), `.link-underline` (animated underline on hover / `aria-current` / `data-active="true"`), `.kpi-number`, `.text-gold-shine`, `.pulse-dot`.
**Components:** Button variants primary (gold gradient + sheen + press scale), blue, green, charcoal, secondary, ghost, danger, gold (alias of primary); Card/Panel/Stat `accent="gold|blue|green|red"`, `premium`, `interactive`, `animated`; AccentLine tones gold/blue/green/tricolor/red; PageHeader (tricolor animated underline); Tabs (gradient gold underline grows on hover/active); Timeline tone green; badges, data-table header, dialog/sheet top rule, toast and empty states restyled. Live demo: `/dev/style-guide`.

### Glow + motion v2 (owner request 2026-10-15)
Overrides the earlier "no glow" stance: glow is allowed but must stay soft, low opacity, warm gold/blue/green (no neon, no blur-glass). Tokens: `--glow-gold|blue|green` (+ `-strong`), `--glow-focus`, `--body-glow-2` (static second warm wash on the body), `--dur-glow`. Utilities: `.glow-gold/.glow-blue/.glow-green` (static), `.glow-hover` (now also on `:focus-visible`; add `.tone-blue|.tone-green` to recolour), `.glow-pulse` (5s breathing, one key element per page), `.glow-focus`, `.enter-up/.enter-fade/.enter-scale` (one-shot, optional `--enter-delay`), `.stagger-fast` (35ms step), `.shimmer` (skeleton), `.float-slow`, `.border-glow` (slow animated gradient ring on premium cards). All loops are >= 2s per cycle (never > 3Hz flashing) and are disabled under `prefers-reduced-motion`.

## 15. Hints system (2026-10-15)
Goal: every part of the product explains itself, without getting in the way, and without storing anything private.
- **Components (`@salesos/ui`):** `HintTip` is a 24px "?" button (44px touch target on phones) that opens a popover: title, 1-3 lines, optional "Learn more". Enter/Space opens, Esc closes and returns focus, the dialog is labelled by its title and described by its body. `PageHint` is a card under the page header ("About this page"): what it is, do this first, good to know. It collapses (`aria-expanded`) and can be dismissed; a dismissed page keeps a small "Show page tips" button. Neither animates beyond a chevron rotation, so reduced motion needs no special case.
- **Wiring:** `PageHeader` renders `<PageHintSlot hintKey?>`. The app (`AppFrame`) provides a route-aware renderer, so every page that uses `PageHeader` gets its hint with no per-page code; pass `hintKey` to override or `hint` to replace. Field/KPI hints: `<FormField info={<Hint id="..." />}>`, `<Stat info=...>`, `<Section info=...>`, or place `<Hint id="..." />` next to any heading/button.
- **Catalogue:** `apps/web/src/features/hints/catalogue.ts` lists page hints (route pattern, optional extra tip line, optional learn-more link) and tip ids. Text lives in `messages/{en,hi,mr}.json` under `hints.page.<id>.{what,first,tip}` and `hints.tip.<id>.{title,body}`; `hints.ui.*` holds labels. A test fails if any id lacks text in any language.
- **State:** `HintsProvider` + `useHints()` keep `{enabled, dismissed[]}` in localStorage under `salesos.hints.v1.<userId>` (try/catch everywhere; works in memory if storage is blocked; no render until the saved choice is read, so dismissed hints never flash). The lightbulb switch in the top bar toggles all hints; "Reset hints" in the account menu clears dismissals and turns hints on.
- **Writing rules:** simple English, truthful to the page as built (read the page), follow the business rules (every lead needs an owner and next action; Closed-Won is not payment received; never auto-Lost; Finance verifies payments). Hints only render where the page itself renders, so they never reveal a page the user cannot open. Hindi/Marathi texts are real translations but still need review by a native speaker before launch.
- **Not built:** a guided first-visit tour (optional in the brief); the page cards already cover "what to do first".

## 16. Light, Dark and System themes (2026-10-15)
**Switching.** Preference `light | dark | system` (default system) is stored in `localStorage` key `salesos.theme.v1` (try/catch; works in memory if storage is blocked). A static inline script in `<head>` (`apps/web/src/lib/theme.ts` `THEME_INIT_SCRIPT`, emitted with the per-request CSP nonce from `src/proxy.ts`) resolves it and sets `<html data-theme="light|dark" data-theme-pref>`, `color-scheme` and `meta theme-color` before first paint, so there is no flash. `ThemeProvider` keeps it in sync (OS changes while on System, other tabs, transitions suppressed for one frame). UI: `ThemeMenu` (sun/moon/monitor icon in the top bar) and `ThemeSegmented` (radiogroup, auth screens and style guide). Labels: `messages/*.json` under `theme`. The web manifest colours are unchanged.
**CSS.** Tokens for dark live in `packages/ui/src/styles/tokens.css` under `:root[data-theme='dark']` and, for no-JS System, `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`. The two blocks must stay identical (unit test).
**Approach: remap the raw ramps, not per-page overrides.** `ivory-*` become dark surfaces, `ink-*` become champagne-tinted light text, `*-50/-100` dark tints, `*-700/-800` light AA text, `gold-500` brighter hero gold. Components keep the same class names and flip automatically.
**Dark palette (not pure black):** canvas `#14110d`, surface `#1c1813`, raised (dialogs, menus, toasts) `#251f17`, wells `#272018`, text `#f3ead6` (14.8:1), muted `#ada18b` (6.9:1), hairlines `#3b3326`, control border `#948b76` (5.2:1), gold 500 `#d2ae58`, blue 600 fill `#2f6fd0`, green 600 fill `#2a7a53`, red 600 fill `#c8372d`, focus ring `#8fb8f5` (8.7:1).
**Rules for authors.**
- Coloured text uses `text-{gold,blue,green,red}-700` (never -600: -600 is a mid-tone fill that carries white text in both themes). Tinted callouts use `bg-X-50 border-X-100 text-X-700`.
- Text on gold fills uses `text-on-gold` (always dark ink), never `text-ink-950`. Solid chips/active pills/tooltips/checked controls use `bg-inverse text-on-inverse border-inverse-line` (near-black in light, deep gold-brown with champagne text in dark).
- Scrims `bg-scrim`; dialogs, sheets, menus and toasts use `--raised-gradient` / `bg-raised`; focus outlines `outline-focus`.
- Never hard-code hex/rgb in components. Shadows come from `--elev-*` / `--shadow-*` (in dark they add a top-edge highlight, hairline and faint gold glow because drop shadows vanish). Charts read `--chart-*`.
- Accent lines gain a faint glow in dark via `--tone-glow-*`; the travelling light and button sheen use `--travel-color` / `--sheen-color`. All of it stays off under `prefers-reduced-motion`.
- Status is never by colour alone in either theme (icon + text).
**Verification (2026-10-15).** Token contrast pairs computed from the CSS (text, muted, controls, focus ring, tinted badges, white on fills, dark ink on gold, chart series): all >= 4.5:1 (text) / 3:1 (UI). Playwright screenshots in both themes at 1280 and 390 for /login, /dashboard/founder, /crm/leads, /revenue/targets, /people, /sop, /dev/style-guide plus dialog, sheet and toasts; axe (WCAG 2.x A/AA tags, real Chromium) clean on all of them and on dialog+toasts. Not covered: data-heavy screens (dev DB empty), print, forced-colors.
