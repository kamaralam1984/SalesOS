import { Injectable } from '@nestjs/common';
import type { Principal } from '../../../common/authz';

/**
 * Phase 5 plugs KPI values into Founder reports through this interface (DI token REPORT_DATA_PROVIDER, exported from CxModule).
 * Until then the default provider returns clearly-labelled placeholders: NEVER fabricated numbers.
 */
export const REPORT_DATA_PROVIDER = Symbol('REPORT_DATA_PROVIDER');

export interface ReportDataRequest {
  user: Principal;
  organizationId: string;
  type: 'WEEKLY' | 'MONTHLY';
  /** YYYY-MM-DD inclusive */
  periodStart: string;
  periodEnd: string;
}

export interface ReportMetric {
  /** KPI dictionary id, e.g. KPI-SAL-001 */
  kpiId: string;
  label: string;
  /** formatted by the provider; null = not computable (zero denominator etc.) */
  value: string | null;
  unit?: string;
  note?: string;
}

export interface ReportDataSection {
  key: string;
  label: string;
  status: 'AVAILABLE' | 'DATA_PENDING_PHASE_5';
  metrics: ReportMetric[];
  note?: string;
}

export interface ReportDataProvider {
  getSections(req: ReportDataRequest): Promise<ReportDataSection[]>;
}

const PENDING_NOTE = 'Data pending Phase 5 (analytics). No numbers are shown until the KPI definitions are wired; add commentary in the narrative instead.';

@Injectable()
export class PendingPhase5ReportDataProvider implements ReportDataProvider {
  async getSections(): Promise<ReportDataSection[]> {
    return [
      { key: 'revenue', label: 'Revenue and collections vs target', status: 'DATA_PENDING_PHASE_5', metrics: [], note: PENDING_NOTE },
      { key: 'funnel', label: 'Funnel and conversion', status: 'DATA_PENDING_PHASE_5', metrics: [], note: PENDING_NOTE },
      { key: 'team', label: 'Team performance and follow-up discipline', status: 'DATA_PENDING_PHASE_5', metrics: [], note: PENDING_NOTE },
      { key: 'customer', label: 'Customer experience (satisfaction, complaints, refunds)', status: 'DATA_PENDING_PHASE_5', metrics: [], note: PENDING_NOTE },
    ];
  }
}
