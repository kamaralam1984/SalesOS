import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { rules: { '@next/next/no-html-link-for-pages': 'off' } },
  {
    ignores: [
      '.next/**',
      '.next-*/**',
      'dist-*/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/sw.js',
      'playwright-report/**',
      'test-results/**',
    ],
  },
];

export default config;
