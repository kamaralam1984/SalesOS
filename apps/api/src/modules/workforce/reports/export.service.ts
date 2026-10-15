import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { WorkforceReportExportQuery, WorkforceReportKey } from '@salesos/validation';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { CONTENT_TYPES, neutralise, toCsv } from '../../reporting/exports/writers';
import type { BuiltReport } from './report-types';
import { reportRowCap, WorkforceReportsService } from './reports.service';

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60);

@Injectable()
export class WorkforceExportService {
  constructor(private readonly reports: WorkforceReportsService, private readonly audit: AuditService) {}

  /** Builds the report under the caller's scope (capped), audits the export, returns the file. Text cells are formula-injection safe. */
  async export(user: Principal, key: WorkforceReportKey, q: WorkforceReportExportQuery) {
    const built = await this.reports.build(user, key, q, reportRowCap());
    const data = q.format === 'xlsx' ? await toXlsx(built, user.name) : toCsv({ columns: built.columns, rows: built.rows });
    await this.audit.record({
      organizationId: user.organizationId, actorId: user.userId, action: AUDIT_ACTIONS.EXPORT_CREATED, entityType: 'workforce_report_export', entityId: key,
      metadata: { report: key, format: q.format, rowCount: built.rows.length, truncated: built.truncated, rowCap: built.rowCap, scopeLevel: built.scopeLevel, range: built.range, filters: built.filters },
    });
    return { data, contentType: q.format === 'xlsx' ? CONTENT_TYPES.XLSX : CONTENT_TYPES.CSV, fileName: `workforce_${safe(key)}_${built.range.from}_${built.range.to}.${q.format}`, rowCount: built.rows.length, truncated: built.truncated };
  }
}

async function toXlsx(r: BuiltReport, generatedFor: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CoachEasily SalesOS';
  wb.created = new Date();
  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === 'text' ? 28 : 16 }));
  ws.getRow(1).font = { bold: true };
  for (const row of r.rows) {
    ws.addRow(Object.fromEntries(r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return [c.key, null];
      if (c.type === 'text') return [c.key, neutralise(String(v))];
      if (c.type === 'date') return [c.key, String(v)];
      const n = Number(v);
      return [c.key, Number.isFinite(n) ? n : null];
    })));
  }
  const about = wb.addWorksheet('About');
  const lines: Array<[string, string]> = [
    ['Report', r.title], ['Generated at (UTC)', new Date().toISOString()], ['Generated for', neutralise(generatedFor)], ['Date range', `${r.range.from} to ${r.range.to}`],
    ['Scope level applied by the server', r.scopeLevel], ['Filters applied', JSON.stringify(r.filters)], ['Rows', String(r.rows.length)], ['Truncated by row cap', r.truncated ? `YES (limit ${r.rowCap})` : 'no'],
    ['Empty cells', 'Not computable or not applicable. Never read an empty cell as 0.'], ['Percent columns', 'Numbers with one decimal (62.5 means 62.5%).'],
  ];
  about.columns = [{ width: 36 }, { width: 90 }];
  lines.forEach((l) => about.addRow(l));
  about.getColumn(1).font = { bold: true };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
