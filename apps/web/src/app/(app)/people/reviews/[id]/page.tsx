import { ReviewDetailPage } from '@/features/people/performance/review-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewDetailPage id={id} />;
}
