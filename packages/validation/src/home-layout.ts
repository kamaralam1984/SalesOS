import { z } from 'zod';

/** Widgets of the phone home screen. Super admins (Founder, Developer) choose which show, their order and size per role. */
export const HOME_WIDGETS = ['stats', 'attendance', 'goal', 'onboarding', 'followups', 'quickActions', 'workspace'] as const;
export type HomeWidgetId = (typeof HOME_WIDGETS)[number];
/** S = compact (85%), M = normal, L = large (115%): the whole widget, icons and text, scales. */
export const HOME_WIDGET_SIZES = ['S', 'M', 'L'] as const;
export type HomeWidgetSize = (typeof HOME_WIDGET_SIZES)[number];

/**
 * What a widget needs to be useful to a role: every permission in `requires`, and (callTeam) a calling role.
 * Used only to tell the editor which widgets apply to a role; the widgets still hide themselves without the permission.
 */
export const HOME_WIDGET_META: Record<HomeWidgetId, { requires: readonly string[]; callTeam?: boolean }> = {
  stats: { requires: ['leads:view'] },
  attendance: { requires: ['attendance:self'] },
  goal: { requires: ['goals:view'] },
  onboarding: { requires: ['onboarding:view'] },
  followups: { requires: ['tasks:view'], callTeam: true },
  quickActions: { requires: ['tasks:view'], callTeam: true },
  workspace: { requires: [] },
};

export const homeWidgetEntrySchema = z.object({
  id: z.enum(HOME_WIDGETS),
  visible: z.boolean(),
  size: z.enum(HOME_WIDGET_SIZES),
});
export type HomeWidgetEntry = z.infer<typeof homeWidgetEntrySchema>;

export const homeLayoutSchema = z.object({
  widgets: z.array(homeWidgetEntrySchema).min(1).max(HOME_WIDGETS.length)
    .refine((w) => new Set(w.map((x) => x.id)).size === w.length, 'duplicate widget'),
});
export type HomeLayoutInput = z.infer<typeof homeLayoutSchema>;

/** The layout used when nobody has customised a role: the built-in order, all visible, normal size. */
export const DEFAULT_HOME_WIDGETS: readonly HomeWidgetEntry[] = [
  { id: 'stats', visible: true, size: 'M' },
  { id: 'attendance', visible: true, size: 'M' },
  { id: 'goal', visible: true, size: 'M' },
  { id: 'onboarding', visible: true, size: 'M' },
  { id: 'followups', visible: true, size: 'M' },
  { id: 'quickActions', visible: true, size: 'M' },
  { id: 'workspace', visible: true, size: 'M' },
];

/** Cleans a stored layout: unknown or repeated widgets are dropped, widgets added later are appended (visible, normal size). */
export function normaliseHomeWidgets(raw: unknown): HomeWidgetEntry[] {
  const out: HomeWidgetEntry[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw) ? raw : []) {
    const p = homeWidgetEntrySchema.safeParse(e);
    if (p.success && !seen.has(p.data.id)) { seen.add(p.data.id); out.push(p.data); }
  }
  for (const d of DEFAULT_HOME_WIDGETS) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}
