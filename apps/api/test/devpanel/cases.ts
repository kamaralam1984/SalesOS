import { DASHBOARD_CASES } from './cases-dashboard';
import { DIAGNOSTICS_CASES } from './cases-diagnostics';
import { SECURITY_CASES } from './cases-security';
import { ACCESS_CASES } from './cases-access';
import { FEATURES_CASES } from './cases-features';
import { MAINTENANCE_CASES } from './cases-maintenance';
import type { NegativeCase } from '../workforce/cases';

export const DEVPANEL_CASES: NegativeCase[] = [...DASHBOARD_CASES, ...DIAGNOSTICS_CASES, ...SECURITY_CASES, ...ACCESS_CASES, ...FEATURES_CASES, ...MAINTENANCE_CASES];
