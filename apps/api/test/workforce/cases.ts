import { A_CASES } from './cases-a';
import { B_CASES } from './cases-b';
import { C_CASES } from './cases-c';
import { D_CASES } from './cases-d';

/** Same shape as the Case table in test/negative-authz.spec.ts. Each workforce area owns ONE file (cases-a..d) so nobody edits the big table. */
export interface NegativeCase {
  route: string; // "METHOD /route/:param" exactly as registered (minus /api/v1)
  deniedUser?: 'execA1' | 'managerA' | 'hr' | 'finance' | 'admin';
  body?: unknown;
  expected?: number[];
}

/** foundation routes (owned by the lead) */
const CORE_CASES: NegativeCase[] = [
  { route: 'GET /workforce/settings', deniedUser: 'execA1' },
  { route: 'PATCH /workforce/settings', deniedUser: 'managerA', body: { goals: { cycleDays: 30 } } },
];

export const WORKFORCE_CASES: NegativeCase[] = [...CORE_CASES, ...A_CASES, ...B_CASES, ...C_CASES, ...D_CASES];
