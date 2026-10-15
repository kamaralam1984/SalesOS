# ADR-004: PWA with no caching of private data

- Status: Accepted (default)
- Date: 2026-10-14

## Context
Master Spec s4: installable PWA if feasible; never cache sensitive API responses or private business data in a public/shared cache; do not imply a write succeeded when offline. Remote sales team on mobile with variable networks. Leads, calls, payments and HR data are private.

## Decision
- Ship `manifest.webmanifest` (name, icons incl. maskable, theme colours, `display: standalone`, start_url `/`), and a service worker.
- Service worker caches ONLY the static app shell and build assets (hashed `/_next/static/*`, icons, fonts, offline fallback page). It NEVER caches: `/api/*`, SSE `/api/v1/stream`, HTML documents of authenticated routes, signed file URLs, or any response with `Set-Cookie`/`Cache-Control: private|no-store`. Strategy: network-only for everything not whitelisted; navigation falls back to a static offline page that shows no user data.
- API responses carry `Cache-Control: no-store` for authenticated data; web server sets `Vary: Cookie` where relevant.
- No background sync / offline queue of mutations in v1. Forms disable submit while offline and show an explicit "You are offline - nothing was saved" notice; optimistic UI only after server acknowledgement for money/status changes; unsent drafts may live in component state only (not persisted) or in `sessionStorage` for non-sensitive text drafts if explicitly approved later.
- On logout/session revoke: unregister runtime caches (none hold private data) and clear any `sessionStorage` drafts.
- Update strategy: versioned cache name, skipWaiting prompt ("New version available"), purge old caches.
- Test: Playwright assertion that after authenticated browsing, Cache Storage contains no `/api` requests and no authenticated HTML; Lighthouse PWA installability.

## Consequences
+ Installable app-like UX with no leakage on shared devices.
- Offline use is read-nothing/write-nothing; acceptable because follow-up work needs the server (calls, tasks).
- Revisit if the owner needs offline call logging: would need encrypted storage + conflict handling + new ADR.
