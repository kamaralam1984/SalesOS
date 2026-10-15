import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

/**
 * Payroll register (area C, DEC-048). NO statutory calculation: PF / ESI / PT / TDS are entered by HR / Finance as manual
 * DEDUCTION components or adjustment lines. Money travels as positive decimal STRINGS with at most 2 dp, never JSON numbers.
 */
export const payrollMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const payrollMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a positive decimal amount with at most 2 decimals, e.g. 12500.00')
  .refine((v) => Number(v) > 0, 'The amount must be greater than zero');

export const PAY_COMPONENT_KINDS = ['EARNING', 'DEDUCTION'] as const;
export const payComponentKindSchema = z.enum(PAY_COMPONENT_KINDS);

export const payComponentSchema = z.object({
  key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Use an UPPER_SNAKE key such as BASIC'),
  name: z.string().trim().min(1).max(80),
  kind: payComponentKindSchema,
  amount: payrollMoneySchema,
});
export type PayComponentInput = z.infer<typeof payComponentSchema>;

/** a real calendar day: the value must survive a UTC round trip ("2026-02-30" would otherwise roll over to 2 March) */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Invalid date');

export const createSalaryStructureSchema = z
  .object({
    userId: uuidSchema,
    effectiveFrom: isoDay,
    currency: z.string().length(3).regex(/^[A-Z]{3}$/).default('INR'),
    components: z.array(payComponentSchema).min(1).max(30),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const keys = v.components.map((c) => c.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['components'], message: 'Component keys must be unique' });
    if (!v.components.some((c) => c.kind === 'EARNING')) ctx.addIssue({ code: 'custom', path: ['components'], message: 'At least one EARNING component is required' });
  });
export type CreateSalaryStructureInput = z.infer<typeof createSalaryStructureSchema>;

export const listStructuresQuerySchema = paginationQuerySchema.extend({ search: z.string().trim().max(100).optional() });

export const createPayrollRunSchema = z.object({ month: payrollMonthSchema, note: z.string().trim().max(500).optional() });
export const listPayrollRunsQuerySchema = paginationQuerySchema.extend({ status: z.enum(['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED']).optional() });

export const addAdjustmentSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: payComponentKindSchema,
  amount: payrollMoneySchema,
  reason: z.string().trim().min(3).max(500),
});
export type AddAdjustmentInput = z.infer<typeof addAdjustmentSchema>;

export const approvePayrollRunSchema = z.object({ note: z.string().trim().max(500).optional() });
export const sendBackPayrollRunSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const cancelPayrollRunSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const markPayrollPaidSchema = z.object({ reference: z.string().trim().min(3).max(120) });
export const exportPayrollRunQuerySchema = z.object({ format: z.enum(['csv']).default('csv') });
export const listPayslipsQuerySchema = paginationQuerySchema;
