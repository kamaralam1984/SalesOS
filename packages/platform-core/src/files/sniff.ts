import type { FileCategory } from './policy';
import { EXTENSIONS, FileRejected } from './policy';

export interface Sniffed {
  mime: string;
  category: FileCategory;
  /** pixel dimensions parsed from the header (images) before any decoding, for decompression-bomb checks */
  width?: number;
  height?: number;
}

const startsWith = (b: Buffer, sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);

function executableKind(b: Buffer): string | null {
  if (startsWith(b, [0x4d, 0x5a])) return 'Windows executable (MZ)';
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return 'ELF executable';
  if (startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return 'Mach-O/Java class';
  if (startsWith(b, [0x23, 0x21])) return 'script (shebang)';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return 'ZIP archive / Office container';
  if (startsWith(b, [0x1f, 0x8b]) || startsWith(b, [0x42, 0x5a, 0x68]) || startsWith(b, [0x37, 0x7a, 0xbc, 0xaf])) return 'compressed archive';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0])) return 'legacy Office/OLE document';
  return null;
}

/** Detect the REAL type from magic bytes. Never trusts the extension or client MIME. */
export function sniff(head: Buffer): Sniffed | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', category: 'image' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // IHDR: width/height are big-endian uint32 at offsets 16 and 20
    return { mime: 'image/png', category: 'image', width: head.length >= 24 ? head.readUInt32BE(16) : undefined, height: head.length >= 24 ? head.readUInt32BE(20) : undefined };
  }
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', category: 'image' };
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', category: 'document' };
  return null;
}

/** CSV is text: valid UTF-8 (BOM allowed), no NUL bytes, not markup. */
export function looksLikeCsv(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (sample.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample.length === buf.length ? sample : sample.subarray(0, sample.length - 4));
  } catch {
    return false;
  }
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 256).toLowerCase();
  if (/^<(!doctype|html|svg|script|\?xml|\?php)/.test(head)) return false;
  return true;
}

/** Throws FileRejected unless the content really is what the (allow-listed) extension claims. Returns the verified type. */
export function verifyContent(extension: string, head: Buffer, whole?: Buffer): Sniffed {
  const def = EXTENSIONS[extension];
  if (!def) throw new FileRejected('EXTENSION_NOT_ALLOWED', `.${extension} is not accepted`);
  const exe = executableKind(head);
  if (exe) throw new FileRejected('EXECUTABLE_OR_ARCHIVE', `Content is a ${exe}, which is not accepted`);
  if (def.category === 'csv') {
    if (!looksLikeCsv(whole ?? head)) throw new FileRejected('MIME_MISMATCH', 'Content is not valid UTF-8 CSV text');
    return { mime: 'text/csv', category: 'csv' };
  }
  const s = sniff(head);
  if (!s || !def.mimes.includes(s.mime)) throw new FileRejected('MIME_MISMATCH', `File content (${s?.mime ?? 'unknown'}) does not match extension .${extension}`);
  return s;
}
