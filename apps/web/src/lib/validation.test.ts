import { describe, expect, it } from 'vitest';
import { loginSchema, setPasswordSchema } from './validation';

describe('login schema', () => {
  it('requires a valid email and a password', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: ' A@B.co ', password: 'x' }).success).toBe(true);
  });
});

describe('set password schema (mirrors API policy)', () => {
  const ok = 'Abcdefghij12';
  it('accepts a strong matching password', () => {
    expect(setPasswordSchema.safeParse({ password: ok, confirm: ok }).success).toBe(true);
  });
  it.each(['Short1a', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsHereAtAll'])(
    'rejects weak password %s',
    (p) => {
      expect(setPasswordSchema.safeParse({ password: p, confirm: p }).success).toBe(false);
    },
  );
  it('rejects a mismatch with a translatable key on confirm', () => {
    const r = setPasswordSchema.safeParse({ password: ok, confirm: ok + 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('passwordMismatch');
  });
});
