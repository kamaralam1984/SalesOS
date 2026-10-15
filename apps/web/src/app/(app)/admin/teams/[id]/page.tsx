import { TeamDetailPage } from '@/features/admin/teams-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamDetailPage id={id} />;
}
