import { describe, expect, it } from 'vitest';
import { safeHref } from './safe-url';

describe('safeHref (stored-XSS guard for user supplied links)', () => {
  it('keeps http(s) links', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
  });
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', '', null, undefined])('drops %j', (v) => {
    expect(safeHref(v as string | null | undefined)).toBeUndefined();
  });
});
