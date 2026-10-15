import { TasksPage } from '@/features/collaboration/tasks-page';

export default async function Page({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  return <TasksPage focus={focus} />;
}
