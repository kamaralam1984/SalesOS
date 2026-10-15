'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_BASE_URL } from '../client';
import type { PaginationMeta } from '../types';

/* ------------------------------------------------------------------ wire types (mirror apps/api/src/modules/workforce/payroll)
 * ALL money values are 2-decimal STRINGS ("12500.00"); never parse them into JS numbers for arithmetic. */
export type Money = string;
export type PayrollRunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type PayComponentKind = 'EARNING' | 'DEDUCTION';

export interface PayComponent {
  key: string;
  name: string;
  kind: PayComponentKind;
  amount: Money;
}
export interface SalaryStructure {
  id: string;
  userId: string;
  effectiveFrom: string;
  currency: string;
  components: PayComponent[];
  monthlyEarnings: Money;
  monthlyDeductions: Money;
  note: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
}
export interface StructureRow {
  userId: string;
  name: string;
  department: string | null;
  employeeCode: string | null;
  designation: string | null;
  current: SalaryStructure | null;
  upcomingVersions: number;
}
export interface StructureHistory {
  userId: string;
  name: string;
  versions: SalaryStructure[];
}

export interface PayslipLine {
  key: string;
  name: string;
  kind: PayComponentKind;
  fullAmount: Money;
  amount: Money;
}
export interface PayslipAdjustment {
  id: string;
  label: string;
  kind: PayComponentKind;
  amount: Money;
  reason?: string;
  addedAt: string;
}
export interface PayslipBasis {
  month: string;
  employedFrom: string | null;
  employedTo: string | null;
  monthWorkingDays: number;
  employedWorkingDays: number;
  counts: Record<string, number>;
  lossOfPay: Record<string, string>;
  lopDays: Array<{ date: string; fraction: string; reason: string }>;
  warnings: string[];
}
export interface Payslip {
  id: string;
  runId: string;
  month: string;
  runStatus: PayrollRunStatus;
  userId: string;
  userName: string | null;
  organizationName: string | null;
  currency: string;
  monthWorkingDays: number;
  workingDays: number;
  paidDays: string;
  lossOfPayDays: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  gross: Money;
  totalDeductions: Money;
  adjustments: PayslipAdjustment[];
  adjustmentsNet: Money;
  net: Money;
  basis: PayslipBasis;
  statutoryDeductionsCalculated: false;
  updatedAt: string;
}
export interface RunTotals {
  currency: string;
  gross: Money;
  deductions: Money;
  adjustments: Money;
  net: Money;
}
export interface Actor {
  id: string;
  name: string | null;
  at: string | null;
}
export interface PayrollRun {
  id: string;
  month: string;
  status: PayrollRunStatus;
  monthWorkingDays: number;
  note: string | null;
  version: number;
  createdBy: Actor | null;
  calculatedAt: string | null;
  approved: Actor | null;
  paid: Actor | null;
  paymentReference: string | null;
  payslipCount: number | null;
  totals: RunTotals[];
  createdAt: string;
  updatedAt: string;
  statutoryDeductionsCalculated: false;
}
export interface PayrollRunDetail extends PayrollRun {
  payslips: Payslip[];
}

export interface StructureInput {
  userId: string;
  effectiveFrom: string;
  currency: string;
  components: PayComponent[];
  note?: string;
}
export interface AdjustmentInput {
  label: string;
  kind: PayComponentKind;
  amount: Money;
  reason: string;
}

type Q = Record<string, string | number | undefined>;
export const payrollKeys = {
  all: ['work', 'payroll'] as const,
  runs: (q: Q) => ['work', 'payroll', 'runs', q] as const,
  run: (id: string) => ['work', 'payroll', 'run', id] as const,
  structures: (q: Q) => ['work', 'payroll', 'structures', q] as const,
  history: (userId: string) => ['work', 'payroll', 'history', userId] as const,
  mine: (q: Q) => ['work', 'payroll', 'mine', q] as const,
  slip: (id: string) => ['work', 'payroll', 'slip', id] as const,
};
const BASE = '/workforce/payroll';

export function usePayrollRuns(q: Q = {}, enabled = true) {
  return useQuery({
    queryKey: payrollKeys.runs(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<PayrollRun[]>(`${BASE}/runs`, q);
      return { items: r.data, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}
export const usePayrollRun = (id: string | undefined) => useQuery({ queryKey: payrollKeys.run(id ?? ''), enabled: !!id, queryFn: async () => (await api.get<PayrollRunDetail>(`${BASE}/runs/${id}`)).data });

export function useStructures(q: Q = {}, enabled = true) {
  return useQuery({
    queryKey: payrollKeys.structures(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<StructureRow[]>(`${BASE}/structures`, q);
      return { items: r.data, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}
export const useStructureHistory = (userId: string | undefined) => useQuery({ queryKey: payrollKeys.history(userId ?? ''), enabled: !!userId, queryFn: async () => (await api.get<StructureHistory>(`${BASE}/structures/${userId}`)).data });

export function useMyPayslips(q: Q = {}) {
  return useQuery({
    queryKey: payrollKeys.mine(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<Payslip[]>(`${BASE}/payslips/mine`, q);
      return { items: r.data, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}
export const usePayslip = (id: string | undefined) => useQuery({ queryKey: payrollKeys.slip(id ?? ''), enabled: !!id, queryFn: async () => (await api.get<Payslip>(`${BASE}/payslips/${id}`)).data });

/** Every payroll mutation refreshes all payroll queries (the server is the only source of truth for status and figures). */
function useInvalidating<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: payrollKeys.all }) });
}
export const useCreateRun = () => useInvalidating(async (b: { month: string; note?: string }) => (await api.post<PayrollRun>(`${BASE}/runs`, b)).data);
export const useCalculateRun = () => useInvalidating(async (id: string) => (await api.post<PayrollRunDetail>(`${BASE}/runs/${id}/calculate`, {})).data);
export const useApproveRun = () => useInvalidating(async (id: string) => (await api.post<PayrollRunDetail>(`${BASE}/runs/${id}/approve`, {})).data);
export const useSendBackRun = () => useInvalidating(async (v: { id: string; reason: string }) => (await api.post<PayrollRunDetail>(`${BASE}/runs/${v.id}/send-back`, { reason: v.reason })).data);
export const useMarkPaidRun = () => useInvalidating(async (v: { id: string; reference: string }) => (await api.post<PayrollRunDetail>(`${BASE}/runs/${v.id}/mark-paid`, { reference: v.reference })).data);
export const useCancelRun = () => useInvalidating(async (v: { id: string; reason: string }) => (await api.post<PayrollRunDetail>(`${BASE}/runs/${v.id}/cancel`, { reason: v.reason })).data);
export const useAddAdjustment = () => useInvalidating(async (v: { runId: string; slipId: string; body: AdjustmentInput }) => (await api.post<Payslip>(`${BASE}/runs/${v.runId}/payslips/${v.slipId}/adjustments`, v.body)).data);
export const useRemoveAdjustment = () => useInvalidating(async (v: { runId: string; slipId: string; adjustmentId: string }) => (await api.delete<Payslip>(`${BASE}/runs/${v.runId}/payslips/${v.slipId}/adjustments/${v.adjustmentId}`)).data);
export const useCreateStructure = () => useInvalidating(async (b: StructureInput) => (await api.post<SalaryStructure>(`${BASE}/structures`, b)).data);

/** The audited CSV export is a plain same-origin GET (session cookie); the browser downloads it. */
export const payrollExportUrl = (runId: string) => `${API_BASE_URL}${BASE}/runs/${runId}/export?format=csv`;
