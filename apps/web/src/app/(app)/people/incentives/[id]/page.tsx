import { IncentiveDetailPage } from '@/features/people/incentives/incentive-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncentiveDetailPage id={id} />;
}
