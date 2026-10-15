import { HandoverDetailPage } from '@/features/cx/handover-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HandoverDetailPage id={id} />;
}
