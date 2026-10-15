import type { PrismaClient } from '@prisma/client';
import type { ConnectionOptions, Job, Queue } from 'bullmq';
import type { DomainEvent } from '@salesos/shared-types';
import type { WorkerEnv } from '../config';
import type { Logger } from '../logger';
import { register as registerAnalytics } from './analytics';
import { register as registerCrm } from './crm';
import { register as registerCx } from './cx';
import { register as registerPeople } from './people';
import { register as registerPlatform } from './platform';
import { register as registerRevenue } from './revenue';
import { register as registerWorkforce } from './workforce';

export interface JobContext {
  prisma: PrismaClient;
  log: Logger;
  env: WorkerEnv;
  connection: ConnectionOptions;
  /** Get (and memoise) a Queue instance for scheduling follow-up jobs. */
  queue(name: string): Queue;
}

/** Handlers MUST be idempotent: BullMQ retries and at-least-once delivery mean they can run more than once. */
export type EventHandler = (event: DomainEvent, ctx: JobContext) => Promise<void>;

export interface ProcessorSpec {
  queue: string;
  concurrency?: number;
  process: (job: Job, ctx: JobContext) => Promise<unknown>;
}

export interface RepeatableSpec {
  queue: string;
  name: string;
  /** cron pattern (UTC) */
  pattern?: string;
  everyMs?: number;
  data?: Record<string, unknown>;
}

export interface JobRegistry {
  /** Subscribe to a domain event (outbox event_type). Several domains may subscribe to one type. */
  onEvent(eventType: string, handler: EventHandler): void;
  /** Own a BullMQ queue with a dedicated processor (reminders, imports, exports...). */
  processor(spec: ProcessorSpec): void;
  /** Schedule a repeatable job (cron / interval). Registration is idempotent. */
  repeatable(spec: RepeatableSpec): void;
}

export class InMemoryJobRegistry implements JobRegistry {
  readonly handlers = new Map<string, EventHandler[]>();
  readonly processors: ProcessorSpec[] = [];
  readonly repeatables: RepeatableSpec[] = [];
  onEvent(eventType: string, handler: EventHandler) {
    this.handlers.set(eventType, [...(this.handlers.get(eventType) ?? []), handler]);
  }
  processor(spec: ProcessorSpec) {
    if (this.processors.some((p) => p.queue === spec.queue)) throw new Error(`Queue ${spec.queue} already has a processor`);
    this.processors.push(spec);
  }
  repeatable(spec: RepeatableSpec) {
    this.repeatables.push(spec);
  }
}

/** One line per domain. Each domain edits ONLY jobs/<domain>/index.ts. */
export const DOMAIN_REGISTRATIONS: ReadonlyArray<readonly [string, (r: JobRegistry) => void]> = [
  ['platform', registerPlatform],
  ['crm', registerCrm],
  ['revenue', registerRevenue],
  ['people', registerPeople],
  ['workforce', registerWorkforce],
  ['cx', registerCx],
  ['analytics', registerAnalytics],
];

export function buildRegistry(): InMemoryJobRegistry {
  const registry = new InMemoryJobRegistry();
  for (const [, register] of DOMAIN_REGISTRATIONS) register(registry);
  return registry;
}
