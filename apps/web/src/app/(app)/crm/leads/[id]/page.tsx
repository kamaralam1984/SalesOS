import { LeadDetailPage } from '@/features/crm/lead-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailPage id={id} />;
}
