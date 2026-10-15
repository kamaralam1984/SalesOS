'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, apiRequest, setCsrfToken } from '../client';
import { qk } from '../keys';
import type { MeResponse } from '../types';

/** Session bootstrap. 401 is a normal "signed out" answer, so it is not retried and does not fire the global handler. */
export function useMeQuery(enabled = true) {
  return useQuery({
    queryKey: qk.me,
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      try {
        const res = await apiRequest<MeResponse>('/auth/me', { skipUnauthorizedHandler: true });
        setCsrfToken(res.data.csrfToken);
        return res.data;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const res = await api.post<Partial<MeResponse> | null>('/auth/login', input, {
        skipUnauthorizedHandler: true,
      });
      if (res.data?.csrfToken) setCsrfToken(res.data.csrfToken);
      return res.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout', {}, { skipUnauthorizedHandler: true });
    },
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: { email: string }) =>
      (await api.post('/auth/password/forgot', input, { skipUnauthorizedHandler: true })).data,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: { token: string; password: string }) =>
      (await api.post('/auth/password/reset', input, { skipUnauthorizedHandler: true })).data,
  });
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: async (input: { token: string; password: string }) =>
      (await api.post('/auth/invite/accept', input, { skipUnauthorizedHandler: true })).data,
  });
}
