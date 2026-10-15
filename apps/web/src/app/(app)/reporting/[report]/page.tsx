import { notFound } from 'next/navigation';
import { ReportPage } from '@/features/reporting/report-page';
import { REPORT_KEYS, type ReportKey } from '@/features/reporting/report-keys';

export default async function Page({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  if (!(REPORT_KEYS as readonly string[]).includes(report)) notFound();
  return <ReportPage reportKey={report as ReportKey} />;
}
