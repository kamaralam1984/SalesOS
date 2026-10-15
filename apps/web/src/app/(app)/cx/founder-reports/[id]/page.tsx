import { FounderReportDetailPage } from '@/features/cx/founder-report-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FounderReportDetailPage id={id} />;
}
