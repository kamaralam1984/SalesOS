import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature scheme (documented in docs/platform-report.md):
 *   header  X-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 * Verification uses the RAW request bytes, a constant-time comparison and a timestamp tolerance (default 300 s, both
 * directions) so captured requests cannot be replayed later. Replays inside the window are stopped by the stored event id.
 */
export function signWebhook(secret: string, rawBody: string | Buffer, timestampSeconds: number = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.`).update(rawBody).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

export type SignatureResult = { ok: true } | { ok: false; reason: 'MISSING' | 'MALFORMED' | 'STALE' | 'MISMATCH' };

export function verifyWebhook(secret: string, rawBody: string | Buffer, header: string | undefined, opts: { toleranceSeconds?: number; nowSeconds?: number } = {}): SignatureResult {
  if (!header) return { ok: false, reason: 'MISSING' };
  const parts = Object.fromEntries(header.split(',').map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
  }));
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isInteger(t) || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return { ok: false, reason: 'MALFORMED' };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: 'STALE' };
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(sig, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'MISMATCH' };
  return { ok: true };
}
