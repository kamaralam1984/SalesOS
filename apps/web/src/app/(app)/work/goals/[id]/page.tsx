import { GoalDetailPage } from '@/features/work/goals/goal-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoalDetailPage id={id} />;
}
