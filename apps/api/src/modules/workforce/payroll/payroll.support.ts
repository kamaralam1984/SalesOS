import { Prisma } from '@prisma/client';
import { formatPaise, parseMoneyToPaise, type Day } from '@salesos/workforce-core';

export const dayOf = (d: Date): Day => d.toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isUniqueViolation = (e: unknown): e is Prisma.PrismaClientKnownRequestError => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface StoredComponent {
  key: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
}
export const asComponents = (v: unknown): StoredComponent[] => (Array.isArray(v) ? (v as StoredComponent[]) : []);
export const monthlyEarnings = (cs: StoredComponent[]): string => formatPaise(cs.filter((c) => c.kind === 'EARNING').reduce((a, c) => a + parseMoneyToPaise(c.amount), 0n));
export const monthlyDeductions = (cs: StoredComponent[]): string => formatPaise(cs.filter((c) => c.kind === 'DEDUCTION').reduce((a, c) => a + parseMoneyToPaise(c.amount), 0n));

/** Role the actor acted in, for audit context. */
export const roleOf = (roles: readonly string[]): string | null => ['FOUNDER_CEO', 'FINANCE', 'HR'].find((r) => roles.includes(r)) ?? roles[0] ?? null;

/** Spreadsheet formula-injection guard for text cells (OWASP CSV injection). */
export const neutralise = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
export function csvCell(v: string | number | null | undefined, text: boolean): string {
  if (v === null || v === undefined) return '';
  const s = text ? neutralise(String(v)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
