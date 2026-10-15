/** Plain (server-importable) list of report keys: the route validates against it; the client page renders by it. */
export const REPORT_KEYS = ['follow-ups', 'conversions', 'funnel', 'revenue', 'team-performance', 'weekly-founder', 'monthly-founder'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
