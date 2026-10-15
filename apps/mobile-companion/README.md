# apps/mobile-companion (NOT built; plan only)

Status: NO-GO for v1 (ADR-005, docs/android-feasibility.md). No code lives here.

Plan if the owner approves a proof of concept (decision DEC-036):
1. Scope: call METADATA only (number, direction, start, duration) after the user returns from a `tel:` call. No recording, no transcription, no bypassing OS security.
2. Explicit in-app disclosure + user-granted permissions; user can revoke at any time; device registered via `POST /devices/register` (feature-flagged).
3. Distribution: private/internal only until Google Play Call Log policy fit is confirmed.
4. Test matrix: Pixel, Samsung, Xiaomi, Oppo/Vivo/Realme, OnePlus on Android 12+; measure capture rate, latency, battery, OEM background kills.
5. Output: go/no-go report; manual logging stays the guaranteed fallback and calls are labelled MANUAL vs DEVICE_VERIFIED.
