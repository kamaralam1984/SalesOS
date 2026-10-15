import { DealDetailPage } from '@/features/revenue/deal-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealDetailPage id={id} />;
}
