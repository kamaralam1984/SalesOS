import { Injectable } from '@nestjs/common';
import type { EmailRequestedPayload } from '@salesos/shared-types';
import { IDENTITY_EVENTS } from '@salesos/shared-types';
import type { Tx } from '../prisma';
import { OutboxService } from './outbox.service';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  organizationId: string;
  userId: string;
  to: string;
  template: EmailRequestedPayload['template'];
  variables: Record<string, string>;
}

/** Contract for outbound email. A real provider (SES, Postmark...) replaces the stub via DI. */
export interface EmailProvider {
  send(tx: Tx, message: EmailMessage): Promise<void>;
}

/**
 * Stub provider: writes a `notification.email.requested` outbox event. No network delivery happens.
 * NOTE: variables (including reset/invite links) live in the outbox payload; a real provider must scrub
 * them after sending. Never log them (the logger redacts `token`/`link`/`variables`).
 */
@Injectable()
export class OutboxEmailProvider implements EmailProvider {
  constructor(private readonly outbox: OutboxService) {}
  async send(tx: Tx, m: EmailMessage): Promise<void> {
    await this.outbox.publish(tx, {
      eventType: IDENTITY_EVENTS.EMAIL_REQUESTED,
      aggregateType: 'user',
      aggregateId: m.userId,
      organizationId: m.organizationId,
      payload: { to: m.to, template: m.template, variables: m.variables } satisfies EmailRequestedPayload as unknown as Record<string, unknown>,
    });
  }
}
