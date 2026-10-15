/**
 * Pending-call memory (BP-AND-002). Tapping a tel: link stores {leadId, name, phone, at} in localStorage so the
 * mandatory disposition sheet can be offered when the user returns to the tab. Pure convenience: if storage is
 * unavailable everything still works through the normal "Log call" buttons. No device permissions involved.
 */
export interface PendingCall {
  leadId: string;
  name: string;
  phone?: string | null;
  at: number;
}
const KEY = 'salesos.crm.pendingCall';
export const PENDING_MAX_AGE_MS = 30 * 60_000;
const EVT = 'salesos:pending-call';

export function readPendingCall(now = Date.now()): PendingCall | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCall;
    if (!p?.leadId || typeof p.at !== 'number' || now - p.at > PENDING_MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}
export function markPendingCall(p: Omit<PendingCall, 'at'>, now = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...p, at: now }));
  } catch {
    /* private mode / blocked storage: fall back to manual logging */
  }
  window.dispatchEvent(new Event(EVT));
}
export function clearPendingCall(leadId?: string): void {
  try {
    const cur = readPendingCall();
    if (!leadId || cur?.leadId === leadId) window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}
export const PENDING_EVENT = EVT;
