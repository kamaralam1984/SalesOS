# ADR-005: Calling strategy

- Status: Accepted (default - awaiting owner approval; DEC-013, DEC-014, DEC-036)
- Date: 2026-10-14
- Evidence: docs/android-feasibility.md

## Context
Salespeople use personal Android phones. Web cannot access the call log or record calls. Google Play restricts Call Log/SMS permissions to default handlers except narrow exceptions and prohibits recorder uses; OEM background limits and consent law add risk.

## Decision
1. **MVP:** `tel:` link on lead detail opens the dialer; on return the UI requires a disposition form (connected, no answer, busy, switched off, callback, failed, won, lost) with notes, interest, objection category, next action. Records have `source = MANUAL` and are labelled so everywhere. Reminders and CRM activity never depend on device permissions. An "unlogged call" prompt appears when the user returns after a `tel:` tap without a disposition (best-effort, based on page visibility).
2. **Verified data later via provider-based cloud telephony** (click-to-call bridged by an approved provider, signed webhooks into `POST /integrations/telephony/webhook`, `source = PROVIDER_VERIFIED`) once the owner picks a provider (DEC-013). Preferred over an Android companion.
3. **Android metadata companion app: gated, NO-GO for v1.** Only after a device PoC and a Play-policy/private-distribution confirmation. If ever built: explicit disclosure, user-granted permissions, no OS-security bypass, no silent recording, `source = DEVICE_VERIFIED`, flag-gated `POST /devices/register`.
4. **Call recording and transcription: out of scope** until a separate technical, consent, privacy and legal review is approved by the owner (`recording_assets` reserved, unused).
5. KPIs that use calls declare the source mix and never merge MANUAL with verified silently.

## Consequences
+ Works on every device today; no policy exposure.
- Data quality depends on discipline; mitigated by reminders, manager review, exception queue.
- Auto-capture of personal-phone calls is explicitly not promised.

## Alternatives rejected
Becoming a default dialer (huge scope); accessibility-based recording (policy-banned for Play); recording by default (legal).
