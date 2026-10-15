import type { NextConfig } from 'next';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  // Parallel agents/CI can isolate build output (NEXT_DIST_DIR=.next-agentd) so builds and servers do not clobber each other.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Docker/standalone deploys (deploy/docker/web.Dockerfile): self-contained server bundle traced from the monorepo root.
  ...(process.env.NEXT_STANDALONE ? { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../..') } : {}),
  reactStrictMode: true,
  // Dev only: allow opening the dev server from a phone on the same Wi-Fi (LAN IP).
  allowedDevOrigins: ['192.168.0.197', '192.168.1.105'],
  poweredByHeader: false,
  transpilePackages: ['@salesos/ui'],
  typedRoutes: false,
  async rewrites() {
    // Same-origin API access for the browser (cookies stay first-party; works from localhost and LAN hosts).
    const target = process.env.API_PROXY_TARGET ?? 'http://localhost:4100';
    return [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }];
  },
  async headers() {
    // CSP (with per-request nonce) is set in src/proxy.ts. Static hardening headers live here.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        // The service worker must never be cached by intermediaries and must be able to control "/".
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
