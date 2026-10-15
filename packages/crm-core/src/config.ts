import { DEFAULT_LOST_REASONS, DEFAULT_STAGES, type StageDef } from './stages';
import { RULE_KEYS, defaultRule, resolveRule, toWorkingHours, type RuleConfig, type RuleKey, type StoredRule } from './rules';
import type { WorkingHours } from './working-hours';
import type { Tx } from './deps';

/** Seeds stages + lost reasons for an organization on first use (idempotent, race-safe via unique + skipDuplicates). */
export async function ensureCrmDefaults(tx: Tx, organizationId: string): Promise<void> {
  if ((await tx.leadStageConfig.count({ where: { organizationId } })) === 0) {
    await tx.leadStageConfig.createMany({
      data: DEFAULT_STAGES.map((s) => ({ organizationId, key: s.key, label: s.label, category: s.category, sortOrder: s.sortOrder, skippable: s.skippable, canClose: s.canClose, allowedNext: s.allowedNext, isSystem: true })),
      skipDuplicates: true,
    });
  }
  if ((await tx.lostReasonConfig.count({ where: { organizationId } })) === 0) {
    await tx.lostReasonConfig.createMany({
      data: DEFAULT_LOST_REASONS.map((r) => ({ organizationId, key: r.key, label: r.label, requiresNote: r.requiresNote, reactivateAfterDays: r.reactivateAfterDays, sortOrder: r.sortOrder })),
      skipDuplicates: true,
    });
  }
}

export async function loadStages(tx: Tx, organizationId: string): Promise<StageDef[]> {
  await ensureCrmDefaults(tx, organizationId);
  const rows = await tx.leadStageConfig.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } });
  return rows.map((r) => ({ key: r.key, label: r.label, category: r.category, sortOrder: r.sortOrder, skippable: r.skippable, canClose: r.canClose, allowedNext: r.allowedNext, isActive: r.isActive }));
}

export async function loadRules(tx: Tx, organizationId: string): Promise<StoredRule[]> {
  const rows = await tx.automationRule.findMany({ where: { organizationId }, select: { teamId: true, ruleKey: true, config: true, isActive: true } });
  return rows;
}

export async function getRule<K extends RuleKey>(tx: Tx, organizationId: string, teamId: string | null, key: K): Promise<RuleConfig<K>> {
  const rows = await tx.automationRule.findMany({ where: { organizationId, ruleKey: key, teamId: { in: teamId ? [teamId] : [] } } });
  const org = await tx.automationRule.findMany({ where: { organizationId, ruleKey: key, teamId: null } });
  return resolveRule([...org, ...rows], key, teamId);
}

export async function getWorkingHours(tx: Tx, organizationId: string, teamId: string | null): Promise<WorkingHours> {
  return toWorkingHours(await getRule(tx, organizationId, teamId, 'WORKING_HOURS'));
}

/** Effective (defaults + org + team) config for every rule key, for read APIs. */
export async function effectiveRules(tx: Tx, organizationId: string, teamId: string | null) {
  const rows = await loadRules(tx, organizationId);
  return Object.fromEntries(RULE_KEYS.map((k) => [k, resolveRule(rows, k, teamId)])) as { [K in RuleKey]: RuleConfig<K> };
}

export { defaultRule };

/** Team a user belongs to (member first, then a team they lead). */
export async function resolveTeamId(tx: Tx, organizationId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const m = await tx.$queryRaw<{ team_id: string }[]>`
    SELECT tm.team_id::text FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ${userId}::uuid AND t.organization_id = ${organizationId}::uuid
    ORDER BY (tm.membership_role = 'MEMBER') DESC, t.created_at ASC LIMIT 1`;
  if (m[0]) return m[0].team_id;
  const led = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM teams WHERE lead_user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at ASC LIMIT 1`;
  return led[0]?.id ?? null;
}
