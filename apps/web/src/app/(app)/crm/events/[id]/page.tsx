import { EventDetailPage } from '@/features/crm/events-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailPage id={id} />;
}
