/** Message areas that live in their own files: messages/<locale>.<area>.json (merged over <locale>.json). */
export const MESSAGE_AREAS = ['work-nav', 'work-attendance', 'work-leave', 'work-goals', 'work-tasks', 'work-payroll', 'work-people', 'work-hr', 'work-reports', 'workspace-home'] as const;

type Tree = { [k: string]: string | Tree };
const isTree = (v: unknown): v is Tree => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge; later files win on conflicts. */
export function mergeMessages(...trees: Tree[]): Tree {
  const out: Tree = {};
  for (const t of trees) {
    for (const [k, v] of Object.entries(t)) {
      const cur = out[k];
      out[k] = isTree(v) && isTree(cur) ? mergeMessages(cur, v) : isTree(v) ? mergeMessages(v) : v;
    }
  }
  return out;
}
