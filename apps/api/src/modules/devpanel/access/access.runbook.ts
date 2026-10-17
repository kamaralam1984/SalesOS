/**
 * Static operations guide, condensed from docs/deployment-runbook.md, docs/backup-restore.md and docs/incident-response.md.
 * Commands are DISPLAYED only; the Developer Panel never executes them (shared-machine rules: CLAUDE.md section 14).
 */
export interface RunbookStep {
  title: string;
  /** Command(s) to copy, run on the server by a human. Optional (some steps are guidance only). */
  command?: string;
  note?: string;
}
export interface RunbookSection {
  id: 'deploy' | 'restart' | 'backup' | 'rollback' | 'incident';
  title: string;
  source: string;
  steps: RunbookStep[];
}

export const RUNBOOK: readonly RunbookSection[] = [
  {
    id: 'deploy',
    title: 'Deploy a release',
    source: 'docs/deployment-runbook.md s4, L1',
    steps: [
      { title: 'Inventory the host (read-only) and choose free ports', command: 'scripts/vps-inventory.sh 3100 4100 4200', note: 'Run on the target host only. It changes nothing.' },
      { title: 'Back up the database and record the checksum before touching anything', command: 'scripts/backup.sh' },
      { title: 'Build the images for the release', command: 'docker build -f deploy/docker/api.Dockerfile -t salesos-api:<version> .', note: 'Same for worker and tools images. The web image needs --build-arg NEXT_PUBLIC_API_URL=https://<public-origin>/api/v1.' },
      { title: 'Prove the migrations, then apply them (expand/contract only)', command: 'pnpm migration-check && pnpm db:migrate', note: 'Never run migrate reset or db push --force-reset on real data.' },
      { title: 'Start the new release alongside, then switch only the Sales OS upstream', command: 'docker compose -p salesos -f docker-compose.prod.yml up -d', note: 'Validate the proxy with nginx -t and reload (never restart) after adding ONE salesos file.' },
      { title: 'Verify', command: 'curl -fsS http://127.0.0.1:4100/api/v1/ready', note: 'Then log in, create a lead, confirm a follow-up reminder fires and the KPI reconciliation check passes. Watch logs for 15 minutes.' },
    ],
  },
  {
    id: 'restart',
    title: 'Restart a service safely',
    source: 'docs/deployment-runbook.md s7, L1.2; docs/incident-response.md s4',
    steps: [
      { title: 'Restart the worker only (safe by design: the outbox is in PostgreSQL)', command: 'systemctl restart salesos-worker', note: 'Compose alternative: docker compose -p salesos restart salesos-worker. Afterwards confirm no duplicate reminders.' },
      { title: 'Restart the API only', command: 'systemctl restart salesos-api', note: 'It drains gracefully (SHUTDOWN_GRACE_MS). Check /ready afterwards.' },
      { title: 'PM2 hosts: always name the app', command: 'pm2 restart salesos-api', note: 'Never pm2 restart all, systemctl restart nginx or docker system prune on a shared machine.' },
      { title: 'Reload the proxy without a restart', command: 'nginx -t && nginx -s reload' },
    ],
  },
  {
    id: 'backup',
    title: 'Backup and restore drill',
    source: 'docs/backup-restore.md',
    steps: [
      { title: 'Logical backup (checksum, manifest, optional age encryption)', command: 'scripts/backup.sh', note: 'Writes <db>_<UTC stamp>.dump, .sha256 and .manifest. Keep an encrypted copy off the host.' },
      { title: 'Restore into a THROWAWAY database and compare against the manifest', command: 'scripts/restore-check.sh <dump>', note: 'Target DB name must end in _restore or _restore_test. Never restore over production without owner approval.' },
      { title: 'Check migration state on the restored database', command: 'prisma migrate status --schema prisma/schema' },
      { title: 'Object storage mirror', command: 'scripts/backup-objects.sh', note: 'Needs the MinIO client (mc). Back up objects in the same window as the database.' },
    ],
  },
  {
    id: 'rollback',
    title: 'Roll back a bad release',
    source: 'docs/deployment-runbook.md s5, L1.3',
    steps: [
      { title: 'Redeploy the previous image tag (the schema is additive, so the old code still works)', command: 'RELEASE=<previous> docker compose -p salesos -f docker-compose.prod.yml up -d', note: 'Restart only salesos-* units. Do not run down-migrations in production.' },
      { title: 'Data damaged? Restore a pre-release dump into a side database first', command: 'scripts/restore-check.sh <pre-release dump>', note: 'Extract affected rows and apply reviewed SQL; full revert only with owner approval.' },
    ],
  },
  {
    id: 'incident',
    title: 'Incident: first 15 minutes',
    source: 'docs/incident-response.md s3-4',
    steps: [
      { title: 'Check liveness and readiness (DB, Redis, worker heartbeat)', command: 'curl -fsS http://127.0.0.1:4100/api/v1/health && curl -fsS http://127.0.0.1:4100/api/v1/ready' },
      { title: 'Capture evidence before changing anything', command: 'docker logs --since 30m salesos-api salesos-worker', note: 'x-request-id is returned on every response and is in every log line.' },
      { title: 'Suspected session theft: rotate SESSION_SECRET (logs everyone out)', note: 'Set a new SESSION_SECRET in the server environment, then restart salesos-api. Review audit_logs for the actor and exports performed.' },
      { title: 'Declare severity, assign an incident commander, keep a UTC timeline', note: 'Blameless post-mortem within 5 working days. Personal-data breach: involve counsel/DPO immediately.' },
    ],
  },
];
