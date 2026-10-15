import Busboy from 'busboy';
import type { Request } from 'express';
import { AppError } from '../../common/http/errors';

export interface ParsedUpload {
  fields: Record<string, string>;
  file: { filename: string; mimeType: string; data: Buffer };
}

/**
 * Streaming multipart reader with hard limits: exactly one file part, bounded field count/size, bytes counted while
 * streaming (the request is aborted past `maxBytesFor(filename)`; nothing is buffered beyond the limit).
 */
export function readUpload(req: Request, opts: { maxBytesFor: (filename: string) => number; hardMax: number }): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] ?? '';
    if (!/^multipart\/form-data/i.test(ct)) return reject(new AppError('UNSUPPORTED_MEDIA_TYPE', 'multipart/form-data with a "file" part is required', 415));
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers, preservePath: true, limits: { files: 1, fields: 10, fieldSize: 1024, parts: 12, fileSize: opts.hardMax + 1, headerPairs: 50 } });
    } catch {
      return reject(new AppError('BAD_MULTIPART', 'Malformed multipart request', 400));
    }
    const fields: Record<string, string> = {};
    let file: ParsedUpload['file'] | null = null;
    let error: AppError | null = null;
    let sawFile = false;

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || sawFile) { error ??= new AppError('BAD_MULTIPART', 'Exactly one "file" part is expected', 400); stream.resume(); return; }
      sawFile = true;
      const filename = info.filename ?? '';
      let limit: number;
      try { limit = opts.maxBytesFor(filename); } catch (e) { error ??= e as AppError; stream.resume(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.length;
        if (size > limit) { error ??= new AppError('FILE_TOO_LARGE', `File exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit`, 413); chunks.length = 0; stream.resume(); return; }
        if (!error) chunks.push(c);
      });
      stream.on('limit', () => { error ??= new AppError('FILE_TOO_LARGE', 'File is too large', 413); });
      stream.on('end', () => { if (!error) file = { filename, mimeType: info.mimeType, data: Buffer.concat(chunks) }; });
    });
    bb.on('filesLimit', () => { error ??= new AppError('BAD_MULTIPART', 'Only one file per request', 400); });
    bb.on('partsLimit', () => { error ??= new AppError('BAD_MULTIPART', 'Too many parts', 400); });
    bb.on('error', () => reject(new AppError('BAD_MULTIPART', 'Malformed multipart request', 400)));
    bb.on('close', () => {
      if (error) return reject(error);
      if (!file) return reject(new AppError('NO_FILE', 'A "file" part is required', 400));
      resolve({ fields, file });
    });
    req.pipe(bb);
  });
}
