/**
 * Domain event contract used by the transactional outbox.
 * Each domain adds its own file under events/<domain>.ts and re-exports it here.
 */
export interface DomainEvent<TPayload = unknown> {
  /** outbox_events.id (also used as the BullMQ jobId => idempotent relay) */
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string | null;
  payload: TPayload;
  occurredAt: string;
  attempt: number;
}

export * from './identity';
export * from './crm';
export * from './revenue';
export * from './people';
export * from './cx';
export * from './platform';
export * from './workforce';
