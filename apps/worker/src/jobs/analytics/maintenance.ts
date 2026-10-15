import type { PrismaClient } from '@prisma/client';

export interface MaintenanceResult {
  expiredExports: number;
  requeuedExports: number;
  deletedOldExports: number;
  deletedOldSnapshots: number;
}

/**
 * Housekeeping for the analytics tables (pure SQL, safe to run on any worker, idempotent):
 *  - exports past `expires_at` lose their file bytes (the row and its audit trail stay);
 *  - exports stuck RUNNING with an expired lease (crashed runner) go back to QUEUED while attempts remain;
 *  - export rows older than 180 days and KPI snapshots older than 800 days are deleted.
 * Generating exports and KPI values happens in the API process (the KPI engine lives there); see docs/analytics-report.md.
 */
export async function runAnalyticsMaintenance(prisma: PrismaClient, now = new Date()): Promise<MaintenanceResult> {
  const expired = await prisma.reportExport.updateMany({ where: { expiresAt: { lt: now }, status: { in: ['READY', 'QUEUED', 'FAILED'] } }, data: { status: 'EXPIRED', content: null } });
  const requeued = await prisma.reportExport.updateMany({ where: { status: 'RUNNING', lockedUntil: { lt: now }, attempts: { lt: 3 } }, data: { status: 'QUEUED', lockedUntil: null } });
  const oldExports = await prisma.reportExport.deleteMany({ where: { requestedAt: { lt: new Date(now.getTime() - 180 * 86_400_000) }, status: { in: ['EXPIRED', 'FAILED'] } } });
  const oldSnapshots = await prisma.kpiSnapshot.deleteMany({ where: { periodEnd: { lt: new Date(now.getTime() - 800 * 86_400_000) } } });
  return { expiredExports: expired.count, requeuedExports: requeued.count, deletedOldExports: oldExports.count, deletedOldSnapshots: oldSnapshots.count };
}
