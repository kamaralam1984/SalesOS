import { Injectable } from '@nestjs/common';
import { PLATFORM_EVENTS, type CallEventPort, type ProviderCallEventInput } from '@salesos/shared-types';
import { PrismaService } from '../../common/prisma';
import { OutboxService } from '../../common/outbox/outbox.service';

/**
 * Default `CallEventPort`: stores provider-verified call events (source = PROVIDER) and publishes
 * `call.provider_event.received`. Agent D replaces/extends it via `CallEventPortRegistry.register(...)`
 * (e.g. to write call_logs with source=PROVIDER). Manual dispositions stay source=MANUAL.
 */
@Injectable()
export class StoringCallEventPort implements CallEventPort {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  async ingest(e: ProviderCallEventInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const data = {
        direction: e.direction, status: e.status, userId: e.userId ?? null, fromNumber: e.fromNumber ?? null, toNumber: e.toNumber ?? null,
        startedAt: e.startedAt ? new Date(e.startedAt) : null, durationSec: e.durationSec ?? null,
      };
      const row = await tx.providerCallEvent.upsert({
        where: { organizationId_provider_providerCallId: { organizationId: e.organizationId, provider: e.provider, providerCallId: e.providerCallId } },
        create: { organizationId: e.organizationId, provider: e.provider, providerCallId: e.providerCallId, source: 'PROVIDER', ...data },
        update: data,
      });
      await this.outbox.publish(tx, {
        eventType: PLATFORM_EVENTS.PROVIDER_CALL_EVENT, aggregateType: 'provider_call_event', aggregateId: row.id, organizationId: e.organizationId,
        payload: { ...e, source: 'PROVIDER', providerCallEventId: row.id },
        idempotencyKey: `call.provider_event:${e.provider}:${e.providerCallId}:${e.status}`,
      });
    });
  }
}

/** Holds the active port. Domains register their own in onModuleInit; the last registration wins and is logged by the caller. */
@Injectable()
export class CallEventPortRegistry implements CallEventPort {
  private port: CallEventPort;
  constructor(defaultPort: StoringCallEventPort) {
    this.port = defaultPort;
  }
  /** The currently active port (so a domain can decorate it instead of replacing the storing default). */
  current(): CallEventPort {
    return this.port;
  }
  register(port: CallEventPort): void {
    this.port = port;
  }
  ingest(e: ProviderCallEventInput): Promise<void> {
    return this.port.ingest(e);
  }
}
