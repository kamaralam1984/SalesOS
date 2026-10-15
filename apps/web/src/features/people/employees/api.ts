'use client';
import { useApiGet, useApiList, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export interface EmployeeRecord {
  id: string | null;
  userId: string;
  name: string | null;
  employmentType: string | null;
  positionTitle: string | null;
  joinDate: string | null;
  probationEndDate: string | null;
  exitDate: string | null;
  exitType: 'VOLUNTARY' | 'INVOLUNTARY' | 'PROBATION_FAILURE' | 'TRANSFER' | null;
  exitReason: string | null;
  updatedAt: string | null;
}
export const useEmployees = (page: number) => useApiList<EmployeeRecord>(pk('employees', 'list'), '/people/employees', { page, limit: 25 });
export const useEmployee = (id: string) => useApiGet<EmployeeRecord>(pk('employees', 'detail', id), `/people/employees/${id}`);
export const useSaveEmployee = (id: string) => useApiMutation<Record<string, unknown>>('put', () => `/people/employees/${id}`);
