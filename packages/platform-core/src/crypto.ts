import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for integration secrets: "v<keyVersion>:<iv b64>:<tag b64>:<ciphertext b64>".
 * The key comes ONLY from the environment (PLATFORM_ENCRYPTION_KEY: 32 bytes, base64 or 64 hex chars).
 * Outside production a key derived from SESSION_SECRET is used so dev/test work out of the box; production
 * refuses to start encrypting without an explicit key.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.PLATFORM_ENCRYPTION_KEY;
  if (raw) {
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('PLATFORM_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return key;
  }
  if (env.NODE_ENV === 'production') throw new Error('PLATFORM_ENCRYPTION_KEY is required in production');
  const seed = env.SESSION_SECRET ?? 'salesos-dev-only-key-seed';
  return createHash('sha256').update(`salesos-platform-secrets:${seed}`).digest();
}

export function encryptSecret(plain: string, key: Buffer, keyVersion = 1): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v${keyVersion}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(envelope: string, key: Buffer): string {
  const [ver, iv, tag, ct] = envelope.split(':');
  if (!ver?.startsWith('v') || !iv || !tag || !ct) throw new Error('Malformed secret envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

/** Last 4 chars only, for "configured" indicators. Never expose more. */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? '****' : `****${plain.slice(-4)}`;
}
