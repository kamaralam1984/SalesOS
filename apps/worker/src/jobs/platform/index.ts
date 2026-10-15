import { IDENTITY_EVENTS, type EmailRequestedPayload } from '@salesos/shared-types';
import type { JobRegistry } from '../registry';
import { registerDeliveryJobs } from './deliveries';
import { registerNotificationEvents } from './events';
import { registerFileJobs } from './files';

/** Platform jobs (Agent F): notifications, deliveries, files, housekeeping. */
export function register(registry: JobRegistry): void {
  // Stub email delivery: there is no real provider yet. Never log the link/variables in production.
  registry.onEvent(IDENTITY_EVENTS.EMAIL_REQUESTED, async (event, ctx) => {
    const p = event.payload as EmailRequestedPayload;
    ctx.log.info(
      { eventId: event.id, template: p.template, to: p.to, ...(ctx.env.NODE_ENV !== 'production' ? { devOnlyLinkPresent: !!p.variables?.link } : {}) },
      'email delivery stub: no provider configured (message NOT sent)',
    );
  });

  registerNotificationEvents(registry);
  registerDeliveryJobs(registry);
  registerFileJobs(registry);

  // Housekeeping: purge expired/used auth tokens and expired idempotency keys nightly.
  registry.processor({
    queue: 'platform-housekeeping',
    concurrency: 1,
    process: async (_job, ctx) => {
      const now = new Date();
      const tokens = await ctx.prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } }] } });
      const keys = await ctx.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
      const sessions = await ctx.prisma.session.deleteMany({ where: { absoluteExpiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
      // notifications: dismissed/read older than 90 days; webhook replay ids older than 30 days (far beyond the 5 minute window)
      const notes = await ctx.prisma.notification.deleteMany({ where: { status: { in: ['READ', 'DISMISSED'] }, createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
      const hooks = await ctx.prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
      ctx.log.info({ tokens: tokens.count, keys: keys.count, sessions: sessions.count, notifications: notes.count, webhookEvents: hooks.count }, 'housekeeping done');
    },
  });
  registry.repeatable({ queue: 'platform-housekeeping', name: 'nightly', pattern: '30 2 * * *' });
}
