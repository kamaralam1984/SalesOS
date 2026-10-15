import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDictionary } from '../../src/modules/reporting/kpi/dictionary-doc';

const FILE = path.resolve(__dirname, '../../../../docs/kpi-dictionary.md');

describe('docs/kpi-dictionary.md is generated from the KPI registry', () => {
  it('is up to date (run `pnpm --filter @salesos/api docs:kpi` to regenerate)', () => {
    const rendered = renderDictionary();
    if (process.env.UPDATE_KPI_DOC === '1') writeFileSync(FILE, rendered);
    expect(readFileSync(FILE, 'utf8')).toBe(rendered);
  });
  it('documents every KPI with the owner-approval status and the zero-denominator rule', () => {
    const doc = readFileSync(FILE, 'utf8');
    const ids = [...doc.matchAll(/^#### (KPI-[A-Z]+-\d+) - /gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(38);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.match(/Approval status:\*\* proposed default - awaiting owner approval/g)?.length).toBe(ids.length);
    expect(doc.match(/Zero-denominator behaviour:/g)?.length).toBe(ids.length);
    expect(doc.match(/Exact implementation:/g)?.length).toBe(ids.length);
  });
});
