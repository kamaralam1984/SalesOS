import { MobileFrame } from '@/features/mobile/mobile-frame';

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileFrame>{children}</MobileFrame>;
}
