import { EmployeeDetailPage } from '@/features/people/employees/employees-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeDetailPage id={id} />;
}
