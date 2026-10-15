import { randomUUID } from 'node:crypto';
import type { SeedContext } from './types';

/**
 * platform demo data (notifications, integration catalogue, one dead-lettered delivery to practise recovery).
 * Every record is labelled [DEMO]; idempotent via dedupe keys / unique constraints. No real provider is enabled (DEC-013).
 */
export async function seedPlatform({ prisma, organizationId, userIds }: SeedContext): Promise<void> {
  await prisma.notificationOrgConfig.upsert({ where: { organizationId }, update: {}, create: { organizationId } });

  const demo: Array<{ local: string; type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; body: string; url: string }> = [
    { local: 'exec.a1', type: 'follow_up.due', severity: 'INFO', title: '[DEMO] Follow-up due today', body: 'Call back the lead you spoke to yesterday.', url: '/crm/tasks' },
    { local: 'exec.a1', type: 'follow_up.overdue', severity: 'WARNING', title: '[DEMO] Follow-up overdue', body: 'A follow-up is 2 days overdue.', url: '/crm/tasks' },
    { local: 'manager.a', type: 'lead.no_next_action', severity: 'WARNING', title: '[DEMO] Lead without a next action', body: 'One lead in your team has no next action.', url: '/crm/leads' },
    { local: 'founder', type: 'founder.action_item', severity: 'WARNING', title: '[DEMO] Action item awaiting your decision', body: 'An item is waiting in your queue.', url: '/' },
    { local: 'admin', type: 'import.failed', severity: 'CRITICAL', title: '[DEMO] Import failed', body: 'The last import could not be processed.', url: '/admin/files' },
  ];
  for (const d of demo) {
    const userId = userIds.get(d.local);
    if (!userId) continue;
    await prisma.notification.createMany({
      data: [{ id: randomUUID(), organizationId, userId, type: d.type, severity: d.severity, title: d.title, body: d.body, actionUrl: d.url, dedupeKey: `demo:${d.type}:${d.local}` }],
      skipDuplicates: true,
    });
  }

  const sandboxes: Array<[string, 'EMAIL' | 'WHATSAPP' | 'SMS' | 'CALENDAR' | 'TELEPHONY']> = [
    ['sandbox-email', 'EMAIL'], ['sandbox-whatsapp', 'WHATSAPP'], ['sandbox-sms', 'SMS'], ['sandbox-calendar', 'CALENDAR'], ['sandbox-telephony', 'TELEPHONY'],
  ];
  for (const [provider, kind] of sandboxes) {
    await prisma.integrationConfig.upsert({ where: { organizationId_provider: { organizationId, provider } }, update: {}, create: { organizationId, provider, kind, enabled: false, mode: 'SANDBOX' } });
  }

  const adminId = userIds.get('admin');
  if (adminId) {
    const id = randomUUID();
    const res = await prisma.notificationDelivery.createMany({
      data: [{
        id, organizationId, userId: adminId, channel: 'EMAIL', provider: 'sandbox-email', toAddress: 'demo.recipient@example.invalid', subject: '[DEMO] Dead-lettered message',
        body: '[DEMO] This delivery failed after all retries so you can practise the recovery flow.', status: 'DEAD_LETTER', attempts: 5, errorCode: 'SANDBOX_TEMPORARY_FAILURE',
        errorMessage: 'sandbox temporary failure', idempotencyKey: 'demo:dead-letter',
      }],
      skipDuplicates: true,
    });
    if (res.count === 1) {
      await prisma.notificationDeliveryEvent.createMany({ data: [
        { deliveryId: id, toStatus: 'QUEUED', source: 'SYSTEM' }, { deliveryId: id, fromStatus: 'QUEUED', toStatus: 'FAILED', source: 'WORKER' }, { deliveryId: id, fromStatus: 'FAILED', toStatus: 'DEAD_LETTER', source: 'WORKER' },
      ] });
    }
  }
}
