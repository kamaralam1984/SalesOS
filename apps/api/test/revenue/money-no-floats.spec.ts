import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../src/modules/revenue');
const SCHEMA = path.resolve(__dirname, '../../../../prisma/schema/revenue.prisma');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : f.endsWith('.ts') ? [path.join(dir, f)] : []));

/**
 * Guard rail (MS-FIN-005): money is Prisma.Decimal only. This test fails if float arithmetic helpers slip into the revenue
 * module or a Float column into the revenue schema. (Lint-equivalent; kept as a test so it runs in the api suite.)
 */
describe('money has no floats', () => {
  const files = walk(ROOT);
  it('scans the revenue module', () => expect(files.length).toBeGreaterThan(15));
  it.each(['parseFloat', 'Number.parseFloat', 'Math.round(', 'Math.floor(', 'Math.ceil(', 'Math.trunc(', 'Math.fround'])('does not use %s', (token) => {
    // calc/periods.ts (calendar/day counting) and calc/high-value.ts (percentile rank index) use Math on non-monetary integers only.
    const NON_MONEY = ['calc/periods.ts', 'calc/high-value.ts'];
    const offenders = files.map((f) => path.relative(ROOT, f)).filter((rel) => !NON_MONEY.includes(rel) && readFileSync(path.join(ROOT, rel), 'utf8').includes(token));
    expect(offenders).toEqual([]);
  });
  it('only money.ts (paise remainder counter) converts a Decimal to a JS number', () => {
    const offenders = files.filter((f) => /\.toNumber\(\)/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual(['calc/money.ts']);
  });
  it('the revenue schema has no Float columns and every money column is Decimal(14,2)', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).not.toMatch(/\bFloat\b/);
    const moneyCols = schema.split('\n').filter((l) => /\bDecimal\??\b/.test(l) && !/^\s*\/\//.test(l));
    expect(moneyCols.length).toBeGreaterThan(20);
    for (const l of moneyCols) expect(l).toMatch(/@db\.Decimal\((14, 2|5, 2)\)/);
  });
  it('every money-bearing table carries an explicit currency column', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    for (const model of ['ProgramPrice', 'Target', 'Deal', 'SalesRecord', 'SaleAdjustment', 'Payment', 'Refund', 'ForecastSnapshot', 'PricingProposal', 'GrowthOpportunity']) {
      const block = schema.slice(schema.indexOf(`model ${model} {`));
      expect(block.slice(0, block.indexOf('\n}')), model).toMatch(/currency\s+String\s+@default\("INR"\)\s+@db\.Char\(3\)/);
    }
  });
});
