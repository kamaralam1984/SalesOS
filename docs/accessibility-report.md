# Accessibility, responsive and PWA report (Phase 10, fork L4)

Date: 2026-10-15. Environment: production build (`next build` + `next start`, port 3512) against API on 4512, DB `salesos_agentl_a11y` (migrate deploy + [DEMO] seed). Chromium via Playwright 1.63, axe-core 4.13 (tags wcag2a/2aa/21a/21aa/22aa).

## What was run (real results)
| Check | Result |
|---|---|
| Route crawler `apps/web/e2e/a11y-crawl.spec.ts` (nav registry + first detail page per list; widths 375/768/1280/1920; per role) | PARTIAL. Only the Founder role finished scanning before the 30-minute per-role timeout: 278 route-width scans, **0 axe violations (all impacts)**, **7 horizontal-overflow findings** (768: /crm/tasks, /crm/overdue, /crm/exceptions, /crm/settings, /revenue/collections, +2px /sop; 375: /people/kpis). /people/kpis @375 was fixed (button row wrapped). The 768px table-page overflows were NOT root-caused or re-verified. The other 8 roles (teamlead, manager, executive, finance, hr, student success, marketing, admin) were NOT crawled. |
| Keyboard-only walkthrough `e2e/a11y-keyboard.spec.ts` | 6/6 pass after fix: login by keyboard + skip link; lead create (dialog focus trap over 50 Tab/Shift+Tab, Escape closes, focus returns to trigger), call log (radio via Space, selects, quick follow-up, save), focus restored after close, task "Mark done" by keyboard; mobile More sheet traps focus and Escape restores focus; reduced motion; chart labels. |
| Reduced motion (`reducedMotion: 'reduce'`) | pass: longest computed animation/transition duration <= 10 ms with a dialog open. |
| Chart screen-reader labels | pass on /dashboard/founder, /reporting, /revenue/forecasts, /cx/satisfaction: every `role="img"` chart has an accessible name (title + plain-language summary) and a Chart/Table toggle exists. |
| PWA `e2e/pwa.spec.ts` | pass: manifest valid (name, short_name, start_url, standalone, 192/512/maskable icons resolve); after login, the SW controls the page and every cache entry is `/_next/static/`, `/icons/` or `/offline.html` (no `/api`, no authenticated HTML); offline navigation shows the static offline page with no business data; offline banner shown; a write attempt while offline fails (network error), no fake success. |
| Contrast `node scripts/contrast-check.mjs` | all required pairs pass (below). |
| Screenshots (mobile 375 + desktop 1280, full page) of dashboard (exec + founder), leads, lead detail, follow-up/tasks, deals, revenue, SOP, complaints, reports via `e2e/a11y-shots.spec.ts` (SHOTS_DIR) | 10 specs ran. Visually inspected: lead detail (mobile), deals (mobile), founder dashboard (desktop): no broken layout seen (fixed bottom nav appears mid-page only because of full-page capture). The other screenshots were captured but NOT individually inspected. |
| apps/web vitest | 51 files / 398 tests pass (one earlier run had 2 flaky failures under load; re-runs green). |

## Fixes made
1. Focus was lost after closing any controlled Dialog/Sheet (Radix restores focus only with a `DialogTrigger`): `packages/ui/src/components/overlays.tsx` now remembers the opener and restores focus on close (WCAG 2.4.3).
2. Form-control boundaries were `line-strong` (#d3c9b5, 1.63:1 on ivory-50), below WCAG 1.4.11 (3:1). New token `--control-border: #8c8576` (3.63:1) used by inputs, textarea, select, combobox, search, secondary button; hover border ink-600; placeholder text ink-400 (3.63:1) -> ink-500 (5.88:1).
3. `roles-page.tsx` "none" dash text ink-400 -> ink-500.
4. `/people/kpis` header action row wraps at 375px (overflow +42px).
5. Added a one-character type fix to another agent's `e2e/uat-journeys.spec.ts` (line 159 `![1]!`) because it broke `next build` typecheck (e2e is in tsconfig).

## Colour contrast (computed, `scripts/contrast-check.mjs`)
Text on ivory-50/100/200/300: ink-900 13.7-17.2, ink-600 7.0-8.8, ink-500 4.69-5.88, gold-700 5.06-6.35, red-700 7.0-8.8, red-600 5.16-6.48, blue-700 6.8-8.5, blue-600 4.81-6.04, green-700 7.0-8.8. Tinted badges: gold-700/gold-50 5.88, red-700/red-50 7.94, blue-700/blue-50 7.70. White on blue-600 6.09, red-600 6.54, gold-700 6.40. Focus ring blue-600 on ivory 5.75-6.04 (>=3). Not valid as text: gold-600 (3.67-4.17; used only for icons, 3:1 OK), gold-500 (2.89), ink-400 (3.63; only decorative icons), blue-500 (4.17). Rule: gold text must be gold-700.

## Not tested / open
- Crawl of 8 of 9 roles and 768px overflow root cause (re-run: `A11Y_REPORT=/path.json pnpm exec playwright test e2e/a11y-crawl.spec.ts`; one role takes ~35 min, raise the per-role timeout or split by role).
- Real screen-reader (NVDA/VoiceOver/TalkBack) testing; zoom/400% reflow; forced-colors; RTL; Hindi/Marathi layouts.
- Keyboard walkthroughs for flows beyond login, lead/call/task, dialogs and sheets.
- Lighthouse not run by this fork.
- Service-worker update flow and installability prompt on a real device.
