# Android Calling Feasibility Study (Phase 9 content, written in Phase 0)

Date of research: 2026-10-14. Author: Phase 0 docs agent. Status: desk research only. **No device testing has been performed.** Nothing here is a guarantee; every policy statement must be re-verified against the live Google Play / Android documentation before any build decision (policies change, and some pages I reached did not show a last-updated date).

## 1. Question
Salespeople use personal Android phones for normal cellular calls. Can a web CRM, or an optional companion app, reliably capture those calls (metadata or audio) so the CRM can auto-log them? (Blueprint s9, PHASE_PROMPTS Phase 9 tasks 1 and 4.)

## 2. Short answer
- A web app/PWA **cannot** read the phone's call log or record calls. Only a native Android app could, and only under tight OS and Google Play constraints.
- **Reliable MVP = `tel:` dialer launch + mandatory manual disposition form.** Works on every phone, needs no permissions.
- A metadata-only companion app (number, direction, start, duration) is *technically possible* for sideloaded/private distribution but **is not guaranteed on Google Play** and has OEM background-execution risk. Treat as optional, gated.
- Call **recording/transcription: NO-GO** for v1 (OS limits, Play policy, consent law).

## 3. Findings (with sources)

### 3.1 Google Play policy - SMS and Call Log permissions
- Google Play requires an app to be actively registered as the user's **default SMS, Phone, or Assistant handler** to declare `READ_CALL_LOG`, `WRITE_CALL_LOG`, `PROCESS_OUTGOING_CALLS` and SMS permissions; the app must ask to be default handler before requesting those permissions and must stop using them when it loses default status. Source: Google Play Console Help, "Use of SMS or Call Log permission groups" https://support.google.com/googleplay/android-developer/answer/9047303 (fetched 2026-10-14; the page shows no last-updated date, only "(c)2026 Google" and an upcoming change effective 2027-01-27 about phone-call account verification no longer qualifying for READ_CALL_LOG). Android developer guide on default handlers confirms the same rule: https://developer.android.com/guide/topics/permissions/default-handlers
- Google may grant **temporary exceptions** for non-default apps only where the permission supports core functionality with no alternative; the listed exception uses (caller ID/spam blocking, backup/restore, device automation, anti-smishing with a track record, etc.) do **not** include "CRM auto-logging of employees' calls." An exception would have to be requested via the Play Console Permissions Declaration Form and could be refused. (Same source.)
- Listed **prohibited uses** include call recording via these permissions (and others, e.g. sale of data). (Same source.)
- Implication: a Play-Store-distributed CRM companion is unlikely to be allowed to read the call log unless it *is* the default phone app (i.e. a full dialer, a large undertaking with emergency-call and telephony obligations). Private distribution (managed Google Play private app / MDM / sideload) changes the Play-review risk but not OS permission rules or the consent/legal obligations; managed-Play policy applicability must be confirmed with Google.

### 3.2 Call recording restrictions
- Google's Play policy (effective 2022-05-11) stopped apps using the **Accessibility API for remote call audio recording**; press coverage: 9to5Google https://9to5google.com/2022/04/21/google-will-block-all-third-party-call-recording-apps-on-play-store-from-may-11/ ; TechRadar https://www.techradar.com/news/google-to-remove-many-call-recording-from-the-play-store-starting-tomorrow . Those articles (2022) also describe earlier OS-level limits: real call-audio capture was blocked for normal apps from about Android 6 and microphone-based recording of the call blocked from Android 10. I could **not** retrieve primary Android documentation for these specific OS limits in this session; community reports (e.g. GrapheneOS tracker https://github.com/GrapheneOS/os-issue-tracker/issues/3401, BCR project https://github.com/HuJK/BCR) say working call recording on modern Android depends on device/OEM support, root or privileged/system apps, and foreground-service notifications.
- Many OEM dialers (Google Phone, Xiaomi, etc.) include native call recording on specific devices/regions with their own announcement of recording; that is user-initiated and cannot be relied on or controlled by a CRM.
- India recording consent is legally unsettled for business use; one telephony vendor's docs describe India as "one-party consent" but recommend an announcement/opt-out, while another treats DPDP Act consent as required (sources: https://developer.exotel.com/docs/faqs/data-privacy , https://exotel.com/glossary/consent-management-telecom-india/ ). Vendor statements are not legal advice. **Legal review is mandatory before any recording.**

### 3.3 CallScreeningService / call-screening role
- `CallScreeningService` (`android.telecom`) is available to apps holding the call-screening role (`RoleManager.ROLE_CALL_SCREENING`) and declares `BIND_SCREENING_SERVICE`. It is designed for **incoming** call screening/caller ID and must respond within a short window (AOSP mirrors indicate ~5 seconds). It does not provide call audio. Sources: AOSP javadoc mirror https://git.aicp-rom.com/frameworks_base.git/plain/telecomm/java/android/telecom/CallScreeningService.java ; Android roles https://source.android.com/docs/core/permissions/android-roles . My attempt to read the official developer.android.com class page returned only navigation, so API-level details (e.g. whether newer releases expose outgoing-call details) are **unverified** here.
- It does not log duration or provide an end-of-call event; it would need to be combined with call-log or telephony state, which brings back the Play policy problem. Not a clean fit.

### 3.4 Telephony state / other APIs
- `TelephonyManager`/`PhoneStateListener`/`TelephonyCallback` need `READ_PHONE_STATE` (Phone permission group, in the same restricted category where Play is concerned) and give state transitions (ringing/offhook/idle) but not reliable numbers on newer releases; background execution is subject to OEM battery management (Xiaomi, Oppo/Vivo, Samsung, OnePlus kill background services), Doze, and foreground-service type rules. (Knowledge-based; not re-fetched; validate on devices.)
- Reading `CallLog.Calls` after the user returns from the dialer (foreground, with user-granted `READ_CALL_LOG`) is the most dependable metadata approach but is exactly the permission Play restricts.

### 3.5 Alternatives
| Option | What it gives | Cost/consent implications | Verdict |
|---|---|---|---|
| A. `tel:` dialer + manual disposition (MVP) | Dialer opens from lead; salesperson logs outcome | Zero permissions, zero cost; accuracy depends on discipline (mitigate with "unlogged call" reminders and manager review) | **Adopt (ADR-005)** |
| B. Cloud telephony click-to-call (provider bridges two legs, e.g. India providers such as Exotel, Knowlarity, MyOperator, Ozonetel) | Provider-verified call events via signed webhooks; optional recording with consent IVR | Per-minute fees; TRAI/DLT and DND rules; virtual number shown to client instead of personal number; recording retention (a vendor lists 90 days default) ; needs provider choice (DEC-013) | **Best path to verified data**; not v1 until provider chosen. Compare vendors, verify pricing/features directly (not researched deeply here) |
| C. Company SIM/eSIM + MDM-managed devices | Company-controlled phones can allow device-owner policies; private Play distribution | Hardware/MDM cost; employees carry second device; legal/HR policy | Possible later |
| D. VoIP/softphone SDK in PWA (WebRTC via provider) | Calls inside the app; metadata in provider | Provider cost; headset/network quality; DLT rules | Possible later with provider |
| E. Android companion, call-log metadata only | Number/direction/start/duration auto-captured | Play policy likely blocks (3.1); OEM kills; explicit disclosure + consent; employee-privacy (personal phones) | Gated; NO-GO v1 |
| F. Call/SMS recording or transcription | Audio/transcripts | OS limits, Play prohibition for many routes, consent/legal, storage and DPDP burden | **NO-GO** until separate legal review |

## 4. What is NOT guaranteed
1. Automatic capture of personal cellular calls on every device/OS version - not guaranteed and not promised.
2. Google Play approval of any app requesting Call Log/SMS permissions - not guaranteed.
3. Background reliability on OEM-customised Android (battery optimisation) - not guaranteed.
4. Call recording or transcription of personal-phone calls - not offered.
5. Accuracy of call duration/outcome in MVP - manual entries are labelled MANUAL and may be wrong.
6. Legal position on recording/consent in India - unresolved; needs qualified counsel.
7. This document reflects research on 2026-10-14 using web search/fetch; some pages were incomplete or undated; no device matrix was tested.

## 5. Proof-of-concept plan (not executed)
Preconditions: owner approves go for PoC; legal consent text approved; test devices. Scope: metadata only.
1. Device matrix: Pixel (stock), Samsung One UI, Xiaomi/Redmi MIUI/HyperOS, Oppo/Vivo/Realme, OnePlus - Android 12 to current. Record manufacturer, OS, battery settings.
2. Build a foreground-only "log last call" helper: after user returns from `tel:` call, app (sideloaded, internal test track) reads the latest `CallLog` entry for the dialled number with explicit in-app disclosure and user-granted permission; posts to `POST /devices/register` + a device-verified call endpoint (source=DEVICE_VERIFIED).
3. Measure: % of calls captured, latency, battery impact, OEM kill rate, permission denial rate. Pass criteria agreed beforehand (e.g. >= 95% capture on foreground flow).
4. Check Play: submit declaration only if distributing via Play; otherwise private distribution policy confirmed.
5. Output: go/no-go report. Plan lives in apps/mobile-companion/README.md; no code in Phase 0.

## 6. Data model readiness (already in design)
`call_logs.source` (MANUAL | DEVICE_VERIFIED | PROVIDER_VERIFIED), `devices` table (gated), `POST /devices/register` (flag), `recording_assets` reserved/unused. KPIs declare source; UI shows a badge; manual and verified are never silently mixed.

## 7. Go / no-go recommendation
- **MVP (Phases 3-4): GO** with `tel:` + manual disposition + unlogged-call reminders + manager review of low-activity users.
- **Android metadata companion: NO-GO for v1.** Revisit after (a) owner decides on provider-based telephony (option B) which gives verified data without Play-permission risk, and (b) a device PoC per section 5 shows acceptable capture. Prefer B over E.
- **Recording/transcription: NO-GO** (APPROVED_OUT_OF_SCOPE) until technical, consent, privacy and legal review is done and the owner signs off.
- Decision needed from owner: DEC-013 (provider), DEC-014 (recording), DEC-036 (companion).

## 8. Sources (accessed 2026-10-14)
1. Google Play Console Help - Use of SMS or Call Log permission groups: https://support.google.com/googleplay/android-developer/answer/9047303
2. Android Developers - Default handlers: https://developer.android.com/guide/topics/permissions/default-handlers
3. AOSP CallScreeningService source mirror: https://git.aicp-rom.com/frameworks_base.git/plain/telecomm/java/android/telecom/CallScreeningService.java
4. Android Open Source Project - Android roles: https://source.android.com/docs/core/permissions/android-roles
5. 9to5Google, Play ban on third-party call recording apps (2022): https://9to5google.com/2022/04/21/google-will-block-all-third-party-call-recording-apps-on-play-store-from-may-11/
6. TechRadar (2022): https://www.techradar.com/news/google-to-remove-many-call-recording-from-the-play-store-starting-tomorrow
7. GrapheneOS issue tracker (community): https://github.com/GrapheneOS/os-issue-tracker/issues/3401
8. BCR open-source call recorder (community): https://github.com/HuJK/BCR
9. Exotel developer docs, data privacy / TRAI: https://developer.exotel.com/docs/faqs/data-privacy , https://developer.exotel.com/docs/faqs/trai-regulations ; Exotel glossary on consent: https://exotel.com/glossary/consent-management-telecom-india/

## Implementation note (Phase 8/9 data model, Agent F)

Nothing in this study changed. What exists in code: `devices` table + `POST /devices/register` / list / approve / revoke behind the `devices.enabled` flag (default OFF; go/no-go remains NO-GO, DEC-036) and a provider-verified call event path (`POST /integrations/telephony/webhook` -> `CallEventPort` -> `provider_call_events.source = PROVIDER`). Manual logging (`source = MANUAL`) stays the guaranteed path; `DEVICE` is reserved. No Android code, no recording; see docs/platform-report.md section 5.
