/** Phone home widgets. Mirrors packages/validation/src/home-layout.ts (the API is the authority and cleans whatever is stored). */
export const HOME_WIDGETS = ['stats', 'attendance', 'goal', 'onboarding', 'followups', 'quickActions', 'workspace'] as const;
export type HomeWidgetId = (typeof HOME_WIDGETS)[number];
export const HOME_WIDGET_SIZES = ['S', 'M', 'L'] as const;
export type HomeWidgetSize = (typeof HOME_WIDGET_SIZES)[number];
export interface HomeWidgetEntry { id: HomeWidgetId; visible: boolean; size: HomeWidgetSize }

export const DEFAULT_HOME_WIDGETS: readonly HomeWidgetEntry[] = HOME_WIDGETS.map((id) => ({ id, visible: true, size: 'M' as const }));

/** S shrinks the whole widget (icons and text) to 85 %, L grows it to 115 %. */
export const SIZE_ZOOM: Record<HomeWidgetSize, number> = { S: 0.85, M: 1, L: 1.15 };

/**
 * Working hours (check-in done, Zoom gone, before check-out) bring calls and goals to the front and let attendance step back.
 * Applies only to the built-in layout; a layout set by the Founder or Developer is shown exactly as set.
 */
export function workingOrder(widgets: readonly HomeWidgetEntry[]): HomeWidgetEntry[] {
  const first: HomeWidgetId[] = ['stats', 'followups', 'quickActions', 'goal', 'attendance', 'onboarding', 'workspace'];
  const rank = (id: HomeWidgetId) => first.indexOf(id);
  return [...widgets].sort((a, b) => rank(a.id) - rank(b.id));
}
