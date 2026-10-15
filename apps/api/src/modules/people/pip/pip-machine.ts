import type { RoleKey } from '@salesos/shared-types';

export type PipState = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'EXTENDED' | 'COMPLETED_SUCCESS' | 'COMPLETED_NOT_IMPROVED' | 'CANCELLED';

export interface PipRule {
  from: PipState[];
  to: PipState;
  /** roles allowed (docs/state-machines.md section 9). Approver steps additionally require pip:approve. */
  roles: RoleKey[];
  needsApprovePermission?: boolean;
  audit: string;
}

/** Section 9 implemented exactly. PENDING_APPROVAL->ACTIVE and EXTENDED->ACTIVE go through POST /approve. */
export const PIP_RULES: PipRule[] = [
  { from: ['DRAFT'], to: 'PENDING_APPROVAL', roles: ['SALES_TEAM_LEAD', 'HR'], audit: 'pip.submitted' },
  { from: ['PENDING_APPROVAL'], to: 'DRAFT', roles: ['FOUNDER_CEO', 'HR'], needsApprovePermission: true, audit: 'pip.returned' },
  { from: ['PENDING_APPROVAL'], to: 'ACTIVE', roles: ['FOUNDER_CEO', 'HR'], needsApprovePermission: true, audit: 'pip.activated' },
  { from: ['ACTIVE'], to: 'EXTENDED', roles: ['SALES_TEAM_LEAD', 'HR'], audit: 'pip.extension_requested' },
  { from: ['EXTENDED'], to: 'ACTIVE', roles: ['FOUNDER_CEO', 'HR'], needsApprovePermission: true, audit: 'pip.extended' },
  { from: ['ACTIVE'], to: 'COMPLETED_SUCCESS', roles: ['SALES_TEAM_LEAD', 'HR'], audit: 'pip.completed' },
  { from: ['ACTIVE'], to: 'COMPLETED_NOT_IMPROVED', roles: ['SALES_TEAM_LEAD', 'HR', 'FOUNDER_CEO'], audit: 'pip.completed' },
  { from: ['ACTIVE', 'DRAFT'], to: 'CANCELLED', roles: ['FOUNDER_CEO', 'HR'], audit: 'pip.cancelled' },
];

export const findPipRule = (from: string, to: string) => PIP_RULES.find((r) => r.to === to && (r.from as string[]).includes(from));
export const PIP_TERMINAL: PipState[] = ['COMPLETED_SUCCESS', 'COMPLETED_NOT_IMPROVED', 'CANCELLED'];
export const PIP_MAX_EXTENSIONS = 1;
