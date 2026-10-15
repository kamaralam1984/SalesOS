'use client';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; 0 = sticky. Defaults: 5000 (8000 for danger). */
  duration?: number;
}
interface ToastItem extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: number;
  description?: string;
  duration: number;
}

interface ToastApi {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}
const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const meta: Record<
  ToastTone,
  { Icon: React.ComponentType<{ className?: string }>; bar: string; icon: string }
> = {
  success: { Icon: CheckCircle2, bar: 'bg-green-600', icon: 'text-green-700' },
  info: { Icon: Info, bar: 'bg-blue-600', icon: 'text-blue-700' },
  warning: { Icon: AlertTriangle, bar: 'bg-gold-500', icon: 'text-gold-700' },
  danger: { Icon: OctagonAlert, bar: 'bg-red-600', icon: 'text-red-700' },
};

const toastGlow: Record<ToastTone, string> = {
  success: 'shadow-[0_8px_24px_rgb(0_0_0/0.10),0_0_18px_rgb(70_160_111/0.22)]',
  info: 'shadow-[0_8px_24px_rgb(0_0_0/0.10),0_0_18px_rgb(60_120_210/0.22)]',
  warning: 'shadow-[0_8px_24px_rgb(0_0_0/0.10),0_0_18px_rgb(201_160_58/0.28)]',
  danger: 'shadow-[0_8px_24px_rgb(0_0_0/0.10),0_0_18px_rgb(200_60_60/0.22)]',
};

export function ToastProvider({
  children,
  dismissLabel = 'Dismiss notification',
}: {
  children: React.ReactNode;
  dismissLabel?: string;
}) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);
  const dismiss = React.useCallback(
    (id: number) => setItems((l) => l.filter((t) => t.id !== id)),
    [],
  );
  const toast = React.useCallback((t: ToastInput) => {
    const id = ++seq.current;
    const tone = t.tone ?? 'info';
    const duration = t.duration ?? (tone === 'danger' ? 8000 : 5000);
    setItems((l) => [
      ...l.slice(-3),
      { id, title: t.title, description: t.description, tone, duration },
    ]);
    return id;
  }, []);
  const api = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottomnav-h)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
        role="region"
        aria-label="Notifications"
      >
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} dismissLabel={dismissLabel} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({
  item,
  onDismiss,
  dismissLabel,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
  dismissLabel: string;
}) {
  const { Icon, bar, icon } = meta[item.tone];
  React.useEffect(() => {
    if (!item.duration) return;
    const h = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(h);
  }, [item, onDismiss]);
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      className={cn('pointer-events-auto relative flex w-full max-w-sm animate-[ui-toast-in_320ms_var(--ease-out)] items-start gap-3 overflow-hidden rounded-xl border border-line bg-(image:--raised-gradient) py-3 pr-2 pl-4', toastGlow[item.tone])}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', bar)} />
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[0.8125rem] text-muted">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => onDismiss(item.id)}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-ivory-200 hover:text-ink"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
