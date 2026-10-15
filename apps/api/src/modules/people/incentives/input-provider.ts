import type { IncentiveInputs } from './engine';

export const INCENTIVE_INPUT_PROVIDER = Symbol('INCENTIVE_INPUT_PROVIDER');

export interface IncentiveInputRequest {
  organizationId: string;
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Supplies the sales/collection/refund figures for a recommendation. The revenue + analytics phases register an
 * implementation under INCENTIVE_INPUT_PROVIDER (e.g. `{ provide: INCENTIVE_INPUT_PROVIDER, useClass: RevenueInputProvider }`
 * in their module, importing PeopleModule's token). Phase 6 deliberately never queries revenue tables.
 * Return `null` when no data is available; the API then requires explicit caller-supplied inputs (422 INPUTS_REQUIRED).
 */
export interface IncentiveInputProvider {
  readonly source: string;
  getInputs(req: IncentiveInputRequest): Promise<IncentiveInputs | null>;
}

/** Default: no automatic data. Inputs must be supplied by the caller (manual entry, recorded as source MANUAL). */
export class ManualInputProvider implements IncentiveInputProvider {
  readonly source = 'MANUAL';
  async getInputs(): Promise<IncentiveInputs | null> {
    return null;
  }
}
