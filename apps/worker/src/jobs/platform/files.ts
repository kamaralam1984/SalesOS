import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { ObjectStorage, processFile, purgeExpiredFiles, scannerFromEnv, storageConfigFromEnv } from '@salesos/platform-core';
import { randomUUID } from 'node:crypto';
import type { JobContext, JobRegistry } from '../registry';

let storage: ObjectStorage | null = null;
const getStorage = () => (storage ??= new ObjectStorage(storageConfigFromEnv()));

async function publish(ctx: JobContext, eventType: string, organizationId: string, fileId: string, payload: object, idempotencyKey: string) {
  await ctx.prisma.outboxEvent.createMany({
    data: [{ id: randomUUID(), eventType, aggregateType: 'file', aggregateId: fileId, organizationId, payload: payload as never, idempotencyKey, availableAt: new Date() }],
    skipDuplicates: true,
  });
}

export function registerFileJobs(registry: JobRegistry): void {
  /**
   * Async processing with bounded retries: transient errors (storage, scanner outage) rethrow so the event consumer retries with
   * exponential backoff; on the LAST attempt the file becomes FAILED (visible + recoverable via POST /files/:id/retry) and the
   * uploader/admins are notified. Content problems end as REJECTED (no retry).
   */
  registry.onEvent(PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, async (event, ctx) => {
    const fileId = (event.payload as { fileId?: string }).fileId;
    if (!fileId || !event.organizationId) return;
    const deps = { prisma: ctx.prisma, storage: getStorage(), scanner: scannerFromEnv(), log: ctx.log };
    const lastAttempt = event.attempt + 1 >= ctx.env.EVENT_JOB_ATTEMPTS;
    try {
      const out = await processFile(deps, fileId);
      const f = await ctx.prisma.fileAsset.findUnique({ where: { id: fileId }, select: { uploaderId: true, displayName: true } });
      if (!f) return;
      const type = out.status === 'READY' ? PLATFORM_EVENTS.FILE_READY : PLATFORM_EVENTS.FILE_REJECTED;
      if (out.status === 'READY') await publish(ctx, type, event.organizationId, fileId, { fileId, userId: f.uploaderId, title: `File ready: ${f.displayName}`, message: out.note }, `${type}:${fileId}`);
      else await publish(ctx, PLATFORM_EVENTS.FILE_FAILED, event.organizationId, fileId, { fileId, userId: f.uploaderId, title: `File rejected: ${f.displayName}`, message: out.note, status: 'REJECTED' }, `file.failed:${fileId}:rejected`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'processing error';
      await ctx.prisma.fileAsset.updateMany({ where: { id: fileId }, data: { attempts: { increment: 1 }, lastError: msg.slice(0, 400) } });
      if (!lastAttempt) throw err;
      const f = await ctx.prisma.fileAsset.update({ where: { id: fileId }, data: { status: 'FAILED', progress: 0 } });
      await publish(ctx, PLATFORM_EVENTS.FILE_FAILED, event.organizationId, fileId, { fileId, userId: f.uploaderId, title: `File processing failed: ${f.displayName}`, message: 'It can be retried from Files.', status: 'FAILED' }, `file.failed:${fileId}:${f.attempts}`);
      ctx.log.warn({ fileId, err: msg }, 'file processing failed after retries');
    }
  });

  // Sweep: re-queue files stuck in a non-terminal state (worker crash / dead outbox event) after 15 minutes.
  registry.processor({
    queue: 'platform-files-sweep',
    concurrency: 1,
    process: async (_job, ctx) => {
      const stale = await ctx.prisma.fileAsset.findMany({
        where: { deletedAt: null, status: { in: ['PENDING', 'SCANNING', 'PROCESSING'] }, updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, take: 100,
      });
      for (const f of stale) {
        await publish(ctx, PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, f.organizationId, f.id, { fileId: f.id, uploaderId: f.uploaderId }, `file.process:${f.id}:sweep:${Math.floor(Date.now() / 900_000)}`);
      }
      return { requeued: stale.length };
    },
  });
  registry.repeatable({ queue: 'platform-files-sweep', name: 'sweep', everyMs: 5 * 60_000 });

  // Retention: soft-delete expired files, purge objects past the purge window.
  registry.processor({
    queue: 'platform-files-retention',
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await purgeExpiredFiles({ prisma: ctx.prisma, storage: getStorage(), log: ctx.log });
      ctx.log.info(r, 'file retention run');
      return r;
    },
  });
  registry.repeatable({ queue: 'platform-files-retention', name: 'nightly', pattern: '45 2 * * *' });
}
