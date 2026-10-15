# File Storage Policy (draft, Phase 0; implemented Phase 8)

Date: 2026-10-14. Defaults from DEC-035; configurable via org settings.

## Principles
All uploads authenticated and authorised (`files:upload`, scoped to the owning entity). Never trust filename, extension, or client MIME. Private object storage only (MinIO in dev `127.0.0.1:9100`, S3/R2 in prod); the web root never serves user files; no public buckets.

## Allowed types (default allowlist)
| Category | Extensions | Verified by | Max size |
|---|---|---|---|
| Images | jpg, jpeg, png, webp | magic bytes + decode check | 10 MB |
| Documents | pdf | magic bytes (`%PDF-`), structure sanity | 10 MB |
| Data imports | csv | UTF-8 text check, row limit 50,000, size 10 MB | 10 MB |
| Spreadsheets (export-only, not uploaded by default) | xlsx | n/a | - |
Audio/video (call recordings): NOT accepted (BLOCKED until legal review). Rejected always: executables/scripts (exe, bat, sh, js, html, svg with scripts, msi, apk, jar), archives (zip etc.) unless a specific feature is approved, macros (docm/xlsm), unknown types. Per-user quota default 100 MB; org quota configurable.

## Upload pipeline
1. Authenticated multipart or pre-signed PUT issued by API (key generated server-side; client never chooses key).
2. Validate: extension allowlist; magic-byte MIME sniff must match extension; size limits enforced streaming; reject double extensions; reject path-traversal in names; filename stored only as sanitised display metadata (never used in the storage key).
3. Key format: `org/<organization_id>/<category>/<yyyy>/<mm>/<uuidv4>` (no user input).
4. Status `PENDING -> SCANNING -> PROCESSING -> READY | REJECTED | FAILED` processed asynchronously in the worker with progress (`GET /files/:id`) and retry (bounded). Malware scan via scanner hook (e.g. ClamAV container) - if no scanner is configured, status READY carries `scan_status=NOT_SCANNED` and the UI says so; never claim scanned.
5. Images: strip EXIF/metadata, auto-orient, resize to max 2048px, re-encode WebP (original kept per below). Decompression-bomb protection: max pixel count (e.g. 40 MP) and memory limit; reject on exceed.
6. PDFs: optional optimisation only if a safe tool is installed (e.g. qpdf/ghostscript in a sandbox); otherwise stored as-is. We never promise every file can be compressed; if the output is larger or unreadable, keep the original.
7. CSV: never executed; exported CSV escapes leading `= + - @` to prevent formula injection.
8. Originals are preserved (no destructive replacement) unless a documented policy says otherwise; derived assets link to the original.
9. Metadata recorded: uploader_id, created_at, size, SHA-256 checksum, storage_key, content_type (sniffed), processing_status, scan_status, retention_until, owner entity.

## Download
Authenticated API issues short-lived signed URLs (TTL <= 5 minutes) after re-checking authorisation; `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`; every download of sensitive classes audited (`files:view`). No permanent public links.

## Retention and deletion
Default retention by category (DEC-018/035): import files 30 days; payment proofs 7 years (financial records); SOP attachments while effective + 3 years; temp/rejected 7 days. Deletion = soft-delete flag + purge job removing object after retention; deletions audited. Backups follow backup-restore.md and are documented as holding deleted data until they expire.

## Abuse tests (Phase 8)
extension spoof, MIME mismatch, path traversal names, oversize, zip/decompression bomb, polyglot, SVG script, executable renamed, scanner outage, signed URL expiry/replay, cross-user access.

## Implementation status (Phase 8, Agent F) - as built

Code: `packages/platform-core/src/files/*` (policy, sniff, scan, storage, process), `apps/api/src/modules/files`, worker `apps/worker/src/jobs/platform/files.ts`. Tests: `apps/api/test/platform/files.spec.ts` (45), `apps/worker/test/platform.spec.ts`, Playwright journey 14.

| Policy item | Status | Notes |
|---|---|---|
| Authenticated multipart upload, streaming size cap | Implemented | busboy, one `file` part, bytes counted while streaming, field/part limits; `preservePath` so traversal names are seen and rejected |
| Extension allowlist, double-extension and dangerous-extension rejection | Implemented | jpg/jpeg/png/webp/pdf/csv only |
| Magic-byte sniff must match extension; declared MIME must agree | Implemented | executables, ELF, Mach-O, scripts (shebang), ZIP/Office containers, gzip/7z, OLE rejected by content even when renamed; HTML/SVG/NUL bytes rejected for CSV |
| Quotas and limits configurable | Implemented | `platform_settings` key `files`, `GET/PATCH /files/settings` (defaults: 10 MB per category, 100 MB per user, 5 GB per org, 40 MP images, 50,000 CSV lines, signed URL 300 s, purge 30 days) |
| Safe generated keys | Implemented | `org/<organization_id>/<category>/<yyyy>/<mm>/<uuid>`; display name is sanitised metadata only |
| Private bucket | Implemented | MinIO/S3 via AWS SDK v3, bucket per environment (`S3_BUCKET`, default `salesos-<NODE_ENV>`), created at boot, never public (test: anonymous GET refused) |
| Status machine and progress | Implemented | PENDING -> SCANNING -> PROCESSING -> READY / REJECTED / FAILED; progress 0-100 on `GET /files/:id` |
| Malware scan hook | Implemented as a hook | `FileScanner` interface: `LocalSignatureScanner` (EICAR only, reports NOT_SCANNED on a pass), `ClamdScanner` (clamd INSTREAM, set `CLAMAV_HOST`/`FILE_SCANNER=clamd`; fails closed: engine outage = ERROR + retry, never READY-as-clean), `NoScanner`. **No antivirus engine ships with the repo**; the UI shows "Not scanned by an antivirus engine". The clamd adapter has not been run against a real clamd |
| Images: strip metadata, auto-orient, <= 2048 px, WebP | Implemented | sharp; derivative at `<key>.derived`, original kept; pixel limit enforced from the header before decoding and again by sharp |
| PDFs | Implemented honestly | optimised only if `qpdf` or `gs` (ghostscript, `-dSAFER`, 30 s timeout) is installed on the worker host and the output is a valid, smaller PDF; otherwise stored as uploaded and the note says so |
| CSV | Implemented | UTF-8 text check, line limit; never executed |
| Originals preserved | Implemented | |
| Metadata | Implemented | uploader, size, SHA-256 (re-verified before processing), key, sniffed type, declared type, status, scan status, processing note, retention |
| Short-lived signed URLs, authenticated download | Implemented | TTL clamped to 5-300 s; `Content-Disposition: attachment`; authenticated stream route adds `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. A signed URL is a bearer link until it expires (documented) |
| Scope inheritance | Implemented | uploader scope via `files:view` (own/team/org; `summary` never lists), plus access through any attached entity via `FileAccessRegistry` resolvers registered by domain modules; unregistered entity types fail closed; payment-proof downloads are audited |
| Soft delete, retention, purge | Implemented | `files:delete` scoped and audited; nightly job soft-deletes past `retention_until` and purges objects `purgeAfterDays` after deletion; retention defaults: CSV 30 days, payment proofs 7 years, rejected/temp 7 days |
| Recording assets | Reserved (BLOCKED, DEC-014) | schema `recording_assets` only; `/recordings` answers 403 `RECORDINGS_DISABLED`, no API enables it |
| Abuse tests | Implemented | traversal, double extension, spoofed MIME/content, oversize, EICAR, decompression-bomb dimensions, executable/archive renames, polyglot trailer, scanner outage, signed-URL expiry/tamper, cross-team and cross-org access |

Not done / limits: no per-file virus-scan result history, no resumable/chunked uploads (10 MB single request), no ZIP/XLSX import, no image formats beyond JPEG/PNG/WebP, no thumbnails other than the 2048 px WebP derivative.
