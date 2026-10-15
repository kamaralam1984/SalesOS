import { AppFrame } from '@/features/auth/app-frame';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
