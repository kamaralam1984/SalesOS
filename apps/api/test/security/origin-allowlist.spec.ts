import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../src/config/env';

const dev = { corsOrigins: ['http://localhost:3100'], isProd: false };
const prod = { corsOrigins: ['https://app.coacheasily.example'], isProd: true };

describe('origin allow-list (CORS + CSRF origin check)', () => {
  it('always allows the explicit list', () => {
    expect(isAllowedOrigin(dev, 'http://localhost:3100')).toBe(true);
    expect(isAllowedOrigin(prod, 'https://app.coacheasily.example')).toBe(true);
  });

  it('outside production a phone on the private LAN can use the dev server, whatever IP it has', () => {
    for (const o of ['http://192.168.1.105:3100', 'http://192.168.0.197:3100', 'http://10.0.0.7:3100', 'http://172.20.1.5:3100', 'http://my-laptop.local:3100']) {
      expect(isAllowedOrigin(dev, o), o).toBe(true);
    }
  });

  it('never allows public hosts, other ports, https-on-LAN look-alikes or tricks', () => {
    for (const o of [
      'http://evil.example',
      'http://evil.example:3100',
      'http://8.8.8.8:3100',
      'http://192.168.1.105:9999', // not the app port
      'http://192.168.1.105', // default port 80 is not the app port
      'http://192.168.1.105:3100.evil.example',
      'http://192.168.1.105:3100/path',
      'http://172.32.0.1:3100', // outside 172.16/12
      'http://192.168.1.105@evil.example:3100',
      'null',
      '',
    ]) {
      expect(isAllowedOrigin(dev, o), o).toBe(false);
    }
  });

  it('production never gets the LAN rule', () => {
    expect(isAllowedOrigin({ corsOrigins: ['https://app.coacheasily.example'], isProd: true }, 'http://192.168.1.105:443')).toBe(false);
    expect(isAllowedOrigin(prod, 'http://192.168.1.105:3100')).toBe(false);
    expect(isAllowedOrigin({ corsOrigins: ['http://localhost:3100'], isProd: true }, 'http://192.168.1.105:3100')).toBe(false);
  });
});
