import { randomUUID } from 'node:crypto';
import type { FilesSettings } from '../settings';

export type FileCategory = 'image' | 'document' | 'csv';

export const EXTENSIONS: Record<string, { category: FileCategory; mimes: string[] }> = {
  jpg: { category: 'image', mimes: ['image/jpeg'] },
  jpeg: { category: 'image', mimes: ['image/jpeg'] },
  png: { category: 'image', mimes: ['image/png'] },
  webp: { category: 'image', mimes: ['image/webp'] },
  pdf: { category: 'document', mimes: ['application/pdf'] },
  csv: { category: 'csv', mimes: ['text/csv'] },
};

/** Extensions that must never appear anywhere in a file name (double-extension / renamed executable defence). */
const DANGEROUS = new Set([
  'exe', 'bat', 'cmd', 'com', 'sh', 'bash', 'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'html', 'htm', 'xhtml', 'svg', 'php', 'phtml', 'py', 'pl', 'rb',
  'jar', 'apk', 'msi', 'dll', 'scr', 'lnk', 'reg', 'hta', 'docm', 'xlsm', 'pptm', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'iso', 'dmg', 'swf', 'xml', 'xhtml', 'asp', 'aspx', 'jsp',
]);

export class FileRejected extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface ParsedName {
  displayName: string;
  extension: string;
  category: FileCategory;
}

/** Sanitise an untrusted upload name into display metadata and decide its (allow-listed) extension. */
export function parseUploadName(raw: string): ParsedName {
  if (!raw || raw.includes('\0')) throw new FileRejected('BAD_NAME', 'Invalid file name');
  if (/(^|[\\/])\.\.([\\/]|$)/.test(raw)) throw new FileRejected('PATH_TRAVERSAL', 'Path traversal in file name is not allowed');
  const base = raw.split(/[\\/]/).pop()!.normalize('NFKC');
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/[^\p{L}\p{N} ._()\-+]/gu, '_').trim().slice(0, 120);
  if (!cleaned || cleaned.startsWith('.')) throw new FileRejected('BAD_NAME', 'Invalid file name');
  const segments = cleaned.toLowerCase().split('.');
  if (segments.length < 2) throw new FileRejected('NO_EXTENSION', 'File extension is required');
  const extension = segments[segments.length - 1]!;
  const inner = segments.slice(1, -1);
  const bad = inner.find((s) => DANGEROUS.has(s) || s in EXTENSIONS);
  if (bad) throw new FileRejected('DOUBLE_EXTENSION', `Double extension (.${bad}) is not allowed`);
  if (DANGEROUS.has(extension)) throw new FileRejected('EXTENSION_BLOCKED', `Files of type .${extension} are not accepted`);
  const def = EXTENSIONS[extension];
  if (!def) throw new FileRejected('EXTENSION_NOT_ALLOWED', `Files of type .${extension} are not accepted`);
  return { displayName: cleaned, extension, category: def.category };
}

/** Generated key: org/<organization_id>/<category>/<yyyy>/<mm>/<uuid> - no user input anywhere. */
export function generateStorageKey(organizationId: string, category: string, now = new Date()): string {
  return `org/${organizationId}/${category}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
}

export function maxBytesFor(category: FileCategory, s: FilesSettings): number {
  return s.maxBytesByCategory[category];
}

export function retentionFor(category: string, s: FilesSettings, now = new Date()): Date | null {
  const days = (s.retentionDays as Record<string, number | null>)[category];
  return days ? new Date(now.getTime() + days * 86_400_000) : null;
}
