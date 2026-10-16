# Deployment record: salesos.kvlbusinesssolutions.com (shared VPS), 2026-10-16

Target: one Ubuntu 22.04 VPS (2 vCPU, 8 GB) that also hosts ~15 unrelated sites (nginx + PM2 + Docker). No secrets in this file.

## What runs (all `salesos-*`, compose project `salesos`, dir `/srv/salesos`)
| Container | Image / notes |
|---|---|
| salesos-postgres | postgres:16-alpine, private network only, 512 MB / 0.75 CPU cap |
| salesos-redis | redis:7-alpine (requirepass, maxmemory 96 MB, noeviction), private network only |
| salesos-minio | MinIO (private object store, loopback/private network only) |
| salesos-api | `salesos-api:<release>`, 127.0.0.1:4100, 768 MB / 1 CPU cap |
| salesos-worker | `salesos-worker:<release>`, 512 MB / 0.5 CPU cap |
| salesos-web | `salesos-web:<release>`, 127.0.0.1:3100, 384 MB / 0.5 CPU cap |

nginx: ONE new file `/etc/nginx/sites-available/<domain>` (+ symlink). Added with `nginx -t` then `nginx -s reload` (never restart). TLS: Let's Encrypt via certbot `--webroot` (`/var/www/salesos-acme`), auto-renewed by the existing certbot timer. Files: `deploy/vps/` (compose, `gen-env.sh`, nginx templates).

## How it was done (reproducible)
1. Read-only inventory (`scripts/vps-inventory.sh`), nginx backup, baseline status of every neighbouring site.
2. Images built ON the server with `docker build --memory/--cpu-quota` caps (the laptop link was too slow); never `docker system prune`.
3. `.env.infra` / `.env.production` generated on the server by `deploy/vps/gen-env.sh` (mode 600, never printed, never committed).
4. First migration as the container-local admin, then `prisma/sql/db-roles.sql` (migrator owns the schema, app role is DML-only), function ownership moved to the migrator, owner bootstrap (`seed`: Founder + Developer, no sample data).
5. Verified: HTTPS 200, API health, /metrics 404 from outside, real login, all neighbouring sites unchanged or better.

## Fixes that were needed in the repo
- Dockerfiles did not copy/build `@salesos/workforce-core` (tsc: TS2307). Added.
- tsc crashed at V8's ~1.25 GB default heap in a memory-capped build container. Build steps now `export NODE_OPTIONS=--max-old-space-size=1800` (build only, not in the image).

## Known gaps / follow-ups
- No antivirus scanner (FILE_SCANNER unset = local EICAR check only, not an AV engine); no SMTP/WhatsApp/SMS/Google providers (DEC-013, blocked by design).
- MinIO image is the old `minio/minio:latest` copied from a laptop (Docker Hub repo is gone); move to a maintained image.
- Backups for `salesos-postgres` and the `miniodata` volume are NOT yet scheduled (the host's `/root/scripts/vps-backup.sh` does not know about them).
- The `salesos-tools` image is large (~4.7 GB); it is only needed for migrations.
- Neighbour fixes made while freeing CPU: PM2 `8rupiya` vs systemd `8rupia-web.service` fought over port 3002 (unit pointed at a directory without a build) -> unit stopped and disabled; duplicate PM2 `vidyt` ids 22/23 (port 3000 clash, ~59k restarts) deleted. Undo notes are on the server in `/root/salesos-deploy-state/stopped-by-deploy.txt`.
- `gravity.kvlbusinesssolutions.com` has no DNS record (certificate cannot renew); not touched.
