import { describe, expect, it } from 'vitest';
import { isCallTeam } from './call-team';

describe('isCallTeam', () => {
  it('is true for the sales team and telecallers', () => {
    expect(isCallTeam(['SALES_EXECUTIVE'])).toBe(true);
    expect(isCallTeam(['SALES_MANAGER'])).toBe(true);
    expect(isCallTeam(['SALES_TEAM_LEAD'])).toBe(true);
    expect(isCallTeam(['MARKETING', 'SALES_EXECUTIVE'])).toBe(true);
  });
  it('is false for every other role and for no roles', () => {
    for (const r of ['MARKETING', 'FINANCE', 'HR', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS', 'ADMIN', 'FOUNDER_CEO'] as const) {
      expect(isCallTeam([r])).toBe(false);
    }
    expect(isCallTeam([])).toBe(false);
    expect(isCallTeam(undefined)).toBe(false);
  });
});
