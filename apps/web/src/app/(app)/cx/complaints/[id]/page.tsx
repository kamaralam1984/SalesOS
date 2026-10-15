import { ComplaintDetailPage } from '@/features/cx/complaint-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ComplaintDetailPage id={id} />;
}
