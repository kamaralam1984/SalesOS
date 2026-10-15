import type { AccessService, PermissionKey, Principal } from '../authz';

/**
 * Audit rows carry domain metadata (amounts, ratings, notes). The audit viewer (Admin, Team Lead, ...) must not learn
 * what the entity's own domain would hide from them (DEC-032: Admin holds no revenue or HR permission), so the metadata of a
 * row is shown only when the caller could read that entity type through its own domain permission at more than summary scope.
 */
const DOMAIN_PERMISSIONS: Array<{ entityTypes: RegExp; anyOf: PermissionKey[] }> = [
  {
    entityTypes: /^(deal|sales_record|payment|refund|target|target_period|forecast|pricing_proposal|strategy_plan|growth_opportunity|revenue_settings|program_revenue_config|feedback)$/,
    anyOf: ['deals:view', 'collections:view', 'refunds:view', 'targets:view', 'forecasts:view', 'proposals:view', 'market-intel:view'],
  },
  {
    entityTypes: /^(incentive|incentive_policy|incentive_recommendation|incentive_adjustment)$/,
    anyOf: ['incentives:policy:view', 'incentives:recommendation:view'],
  },
  {
    entityTypes: /^(improvement_plan|pip|performance_review|review|review_rubric|scorecard|candidate|requisition|employee_profile|probation_review|onboarding_plan|onboarding_template|succession_position|succession_candidate|role_expectation|one_on_one|coaching_session|recognition|recognition_program|resource_assignment)$/,
    anyOf: ['reviews:view', 'pip:view', 'hiring:view', 'onboarding:view', 'succession:view', 'coaching:view', 'hr:records:view', 'scorecards:view', 'recognition:view'],
  },
  { entityTypes: /^(complaint|escalation|satisfaction_response|handover|founder_report|risk|action_item)$/, anyOf: ['complaints:view', 'satisfaction:view', 'handover:view', 'founder-reports:view', 'action-items:view', 'relationships:view'] },
];

export const REDACTED_METADATA = { redacted: true } as const;

export function canSeeAuditMetadata(access: AccessService, user: Principal, entityType: string): boolean {
  const rule = DOMAIN_PERMISSIONS.find((r) => r.entityTypes.test(entityType));
  if (!rule) return true;
  return rule.anyOf.some((k) => access.has(user, k) && !access.isSummaryOnly(user, k));
}

export function redactAuditRow<T extends { entityType: string; metadata: unknown }>(access: AccessService, user: Principal, row: T): T {
  return canSeeAuditMetadata(access, user, row.entityType) ? row : { ...row, metadata: REDACTED_METADATA };
}
