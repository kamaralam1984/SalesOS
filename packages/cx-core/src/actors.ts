import type { Actor, Rule } from './machines';

export interface ActorContext {
  roles: readonly string[];
  isOwner: boolean;
  isRequester?: boolean;
}

/** Which abstract actors the caller currently is (see machines.ts header). */
export function actorsOf(ctx: ActorContext): Set<Actor> {
  const s = new Set<Actor>();
  if (ctx.isOwner) s.add('OWNER');
  if (ctx.isRequester) s.add('REQUESTER');
  if (ctx.roles.includes('FOUNDER_CEO')) ['MANAGER', 'TEAM_LEAD', 'FOUNDER'].forEach((a) => s.add(a as Actor));
  if (ctx.roles.includes('SALES_TEAM_LEAD')) ['MANAGER', 'TEAM_LEAD'].forEach((a) => s.add(a as Actor));
  if (ctx.roles.includes('SALES_MANAGER')) s.add('MANAGER');
  if (ctx.roles.includes('STUDENT_SUCCESS')) s.add('STUDENT_SUCCESS');
  return s;
}

export function ruleAllows<S extends string>(rule: Rule<S>, ctx: ActorContext): boolean {
  const mine = actorsOf(ctx);
  return rule.actors.some((a) => a !== 'SYSTEM' && mine.has(a));
}

/** Names of required fields that are missing/blank in `input`. */
export function missingRequired(rule: Rule<string>, input: Record<string, unknown>): string[] {
  return rule.required.filter((k) => {
    const v = input[k];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
}
