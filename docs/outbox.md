# Transactional outbox (Phase 1/2 backend)

Why: a domain change and the event/reminder it triggers must succeed or fail together. Writing to Redis inside a request can lose the event after the DB commit (or send it for a rolled-back change). The outbox stores the event in PostgreSQL inside the same transaction; the worker relays it to BullMQ.

```
API request tx:  business rows + outbox_events(PENDING)  --commit-->
Worker dispatcher (poll, FOR UPDATE SKIP LOCKED) --queue.add(jobId = outbox id)--> BullMQ "domain-events"
BullMQ consumer -> handlers registered per event type (apps/worker/src/jobs/<domain>/index.ts)
        retries (exponential backoff) -> exhausted -> "domain-events-dead" + outbox row DEAD
```

## Producing an event (API side)

```ts
await prisma.$transaction(async (tx) => {
  await tx.lead.update(...);
  await outbox.publish(tx, {
    eventType: 'lead.assigned',          // dotted, past tense; declare payload type in packages/shared-types/src/events/<domain>.ts
    aggregateType: 'lead', aggregateId: lead.id, organizationId: user.organizationId,
    payload: { leadId, toUserId },       // JSON only, no secrets
    idempotencyKey: `lead.assigned:${lead.id}:${version}`, // optional; duplicates are ignored
    availableAt: new Date(Date.now() + 15 * 60_000),       // optional delayed delivery (reminders)
  });
});
```

`OutboxService.publish(tx, ...)` requires the caller's transaction client. `publishStandalone` exists for code with no surrounding transaction (prefer `publish`).

## Consuming (worker side)

```ts
// apps/worker/src/jobs/crm/index.ts
export function register(registry: JobRegistry) {
  registry.onEvent('user.deactivated', async (event, ctx) => {
    // MUST be idempotent: delivery is at-least-once (retries, relay after crash).
    // Use event.id (stable) as the idempotency key for any side effect you create.
  });
}
```

Several domains may subscribe to the same event type; handlers run sequentially in registration order and one failing handler fails (and retries) the whole job, so keep handlers idempotent.

## Guarantees and limits

- Relay failure (Redis down): the row stays PENDING, `attempts++`, `available_at` = now + min(2^attempts s, 5 min); after `OUTBOX_MAX_DISPATCH_ATTEMPTS` (8) the row is DEAD with `last_error`.
- Crash after `queue.add` but before marking DISPATCHED: the row is re-relayed with the same `jobId` (= outbox id) so BullMQ does not create a second job.
- Several dispatchers can run (SKIP LOCKED) - no row is claimed twice concurrently.
- Job retries: `EVENT_JOB_ATTEMPTS` (5), exponential backoff from `EVENT_JOB_BACKOFF_MS` (2 s). Exhausted jobs are copied to `domain-events-dead` (jobId `dead-<outbox id>`, kept for replay) and the outbox row becomes DEAD.
- Ordering is by creation time per dispatch batch, not guaranteed end-to-end (concurrent consumers, retries). Do not rely on it; carry a version/timestamp in the payload when order matters.
- Delivered != processed: `outbox_events.status = DISPATCHED` means "queued in BullMQ". Domains that need delivery status (notifications) track their own status table.
- Housekeeping: DISPATCHED rows are not purged yet (Phase 10 retention task). Use the `outbox_events (status, available_at)` index for the pending scan.

## Events published by identity

| Event | Payload | Consumer |
|---|---|---|
| `user.created` | userId, organizationId, createdById | - |
| `user.deactivated` | userId, organizationId, managerId, deactivatedById, reason | **CRM agent**: build the reassignment queue for the user's open leads/tasks (idempotent on event.id / userId+deactivatedAt) |
| `user.reactivated` | userId, organizationId, reactivatedById | - |
| `user.roles_changed` | userId, organizationId, before[], after[], changedById | - |
| `notification.email.requested` | to, template (`password_reset`/`invite`), variables.link | platform email stub (logs "NOT sent") |

`user.deactivated` carries an `idempotencyKey` of `user.deactivated:<userId>:<deactivatedAt ISO>`, so reactivate -> deactivate cycles produce distinct events while retries do not.

## Events produced / consumed by the platform module (Agent F)

| Event | Producer | Consumer |
|---|---|---|
| `notification.requested` (payload = `NotifyRequest`) | any domain | platform worker -> notification core (dedupe, preferences, quiet hours, channels) |
| `file.process_requested` | API on upload / retry | platform worker (scan, process) |
| `file.ready`, `file.failed` | platform worker | platform worker (notify uploader + ADMIN) |
| `notification.delivery.dead_lettered` | platform worker | informational (admins are also notified in-app) |
| `call.provider_event.received` | telephony webhook | CRM (Agent D) may reconcile with call logs |
| mapped domain events (`task.*`, `lead.unattended`, `lead.exception_raised`, `complaint.*`, `payment.*`, `refund.*`, `handover.*`, `import.completed|failed`, `user.deactivated`, `user.roles_changed`) | their domains | platform worker (raises notifications; see docs/platform-report.md 1.1) |
