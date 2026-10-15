import { Employee360Page } from '@/features/work/people/employee-360-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Employee360Page id={id} />;
}
