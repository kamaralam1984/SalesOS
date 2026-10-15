import { RelationshipViewPage } from '@/features/cx/relationships-page';

export default async function Page({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return <RelationshipViewPage leadId={leadId} />;
}
