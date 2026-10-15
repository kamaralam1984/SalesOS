import ExcelJS from 'exceljs';
import type { ReportColumn, ReportResult } from '../reports/types';

/**
 * Spreadsheet formula injection guard (OWASP CSV injection): a cell that starts with = + - @ TAB or CR is prefixed with an apostrophe
 * so Excel / Sheets treat it as text. Applied to every TEXT value in CSV and XLSX.
 */
export function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const csvCell = (v: string | number | boolean | null | undefined, col: ReportColumn): string => {
  if (v === null || v === undefined) return '';
  const s = col.type === 'text' ? neutralise(String(v)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV, UTF-8 with BOM so Excel opens Hindi/Marathi names correctly. Empty value = not computable (never 0 or NaN). */
export function toCsv(r: Pick<ReportResult, 'columns' | 'rows'>): Buffer {
  const lines = [r.columns.map((c) => csvCell(c.label, { ...c, type: 'text' })).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row[c.key], c)).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

export async function toXlsx(r: ReportResult, extra: { generatedFor?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CoachEasily SalesOS';
  wb.created = new Date();
  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === 'text' ? 28 : 16 }));
  ws.getRow(1).font = { bold: true };
  for (const row of r.rows) {
    ws.addRow(
      Object.fromEntries(
        r.columns.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return [c.key, null];
          if (c.type === 'text') return [c.key, neutralise(String(v))];
          if (c.type === 'date') return [c.key, String(v)];
          const n = Number(v);
          return [c.key, Number.isFinite(n) ? n : null];
        }),
      ),
    );
  }
  r.columns.forEach((c, i) => {
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
    if (c.type === 'pct') ws.getColumn(i + 1).numFmt = '0.0';
  });
  const about = wb.addWorksheet('About');
  const lines: Array<[string, string]> = [
    ['Report', r.title],
    ['Generated at (UTC)', r.meta.computedAt],
    ['Date range (IST)', `${r.meta.dateRange.from} to ${r.meta.dateRange.to}`],
    ['Currency', r.meta.currency],
    ['Scope level applied by the server', r.meta.filters.scopeLevel],
    ['Filters applied', JSON.stringify(r.meta.filters.applied)],
    ['Rows', String(r.rowCount)],
    ['Truncated by row cap', r.truncated ? `YES (limit ${r.rowLimit})` : 'no'],
    ['Empty cells', 'Not computable (for example zero denominator). Never read an empty cell as 0.'],
    ['Percent columns', 'Shown as numbers with one decimal (62.5 means 62.5%).'],
    ['Money', 'INR with two decimals; shown as numbers.'],
    ...r.meta.definitions.map((d): [string, string] => [d.id, `${d.name} (${d.approvalStatus})`]),
  ];
  if (extra.generatedFor) lines.splice(2, 0, ['Generated for', extra.generatedFor]);
  about.columns = [{ width: 36 }, { width: 90 }];
  lines.forEach((l) => about.addRow(l));
  about.getColumn(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export const CONTENT_TYPES = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
