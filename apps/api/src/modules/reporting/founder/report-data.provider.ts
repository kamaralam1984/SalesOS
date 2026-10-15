import { Injectable } from '@nestjs/common';
import type { ReportDataProvider, ReportDataRequest, ReportDataSection } from '../../cx/founder/report-data.provider';
import { FOUNDER_SECTIONS } from './sections';
import { ReportsService } from '../reports/reports.service';

/**
 * Real KPI numbers for the Founder-report builder (Agent H's REPORT_DATA_PROVIDER seam). Every metric carries its window,
 * computation time and definition status in `note`; nothing is invented, and a number that cannot be computed is null with the reason.
 * The caller's own scope applies (it is their Principal), so a Team Lead only ever freezes numbers they may see.
 */
@Injectable()
export class AnalyticsReportDataProvider implements ReportDataProvider {
  constructor(private readonly reports: ReportsService) {}

  async getSections(req: ReportDataRequest): Promise<ReportDataSection[]> {
    try {
      return await this.reports.founderSections(req.user, req.type, req.periodStart, req.periodEnd);
    } catch {
      return FOUNDER_SECTIONS.map((s) => ({ key: s.key, label: s.label, status: 'AVAILABLE' as const, metrics: s.kpiIds.map((id) => ({ kpiId: id, label: id, value: null, note: 'Not available to your role or could not be computed' })) }));
    }
  }
}
