# ADR-003: Transactional outbox + BullMQ reliability

- Status: Accepted (default)
- Date: 2026-10-14

## Context
Blueprint s5/s7: use a transactional outbox so reminder events are not lost between DB commit and queue publishing; BullMQ jobs need bounded retries, exponential backoff, dead-letter handling, idempotent notification keys, atomic task locking, delivery status tracking (queued is not delivered), and reminders must survive worker restarts.

## Decision
1. **Outbox:** any state change that must trigger asynchronous work writes an `outbox_events` row in the SAME database transaction (call + task + status history + outbox). Columns: id, aggregate_type/id, type, payload, status (PENDING/PUBLISHED/FAILED), attempts, available_at, idempotency_key (unique), created_at.
2. **Relay:** a worker loop claims rows with `SELECT ... FOR UPDATE SKIP LOCKED` (batch, ordered by available_at), enqueues BullMQ jobs with `jobId = idempotency_key` (BullMQ dedups), marks PUBLISHED. Crash between enqueue and mark => re-enqueue is harmless due to jobId dedup.
3. **Jobs:** `attempts` bounded (default 5), `backoff: exponential` (base 30s), jitter; after final failure move to dead-letter queue (`salesos:dlq`) and create an in-app alert for Admin/Manager; DLQ viewable and retryable via API (`jobs:dlq:*`).
4. **Idempotent notifications:** `notification_deliveries.idempotency_key` unique = hash(kind, entity_id, recipient, channel, window). Processor inserts first (ON CONFLICT DO NOTHING); only the inserter sends.
5. **Atomic claim:** state transitions (e.g. task OPEN->OVERDUE, delivery QUEUED->SENT) use compare-and-set updates (`UPDATE ... WHERE status = :expected RETURNING`) so concurrent workers cannot double-process.
6. **Recovery:** scheduler jobs (BullMQ repeatables) + a sweeper that re-derives due/overdue state from the database, so Redis loss does not lose reminders (Redis is a transport, PostgreSQL is the truth). Redis persistence AOF enabled in non-dev.
7. **Delivery truth:** statuses QUEUED, SENT, DELIVERED, FAILED, SUPPRESSED; DELIVERED only on provider callback (or persistence for in-app); provider error codes stored; UI never says delivered earlier.
8. **Graceful shutdown:** worker stops taking jobs, waits for active ones (timeout), releases claims.
9. **Observability:** metrics for outbox lag, queue depth, failures, DLQ size; alert thresholds in runbook.

## Consequences
+ No lost reminders; duplicates prevented; restart-safe (test required: kill worker mid-flight).
- Slight latency (relay polling 1-2s; optional LISTEN/NOTIFY wake-up).
- Outbox table needs cleanup job (retain 14 days of PUBLISHED).

## Alternatives rejected
Publishing to Redis inside the request path (dual-write loss); Kafka (overkill); cron-only reminders (poor latency, still needs idempotency).
