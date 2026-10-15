import { PayrollRunPage } from '@/features/work/payroll/run-detail-page';

export default async function Page({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  return <PayrollRunPage month={month} />;
}
