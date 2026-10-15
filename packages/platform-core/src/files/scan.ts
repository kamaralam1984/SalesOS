import net from 'node:net';

export type ScanVerdict = { status: 'CLEAN' | 'INFECTED' | 'NOT_SCANNED' | 'ERROR'; detail: string };

export interface FileScanner {
  readonly name: string;
  scan(data: Buffer): Promise<ScanVerdict>;
}

/** Standard EICAR anti-virus test string (harmless, recognised by every engine). */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Local signature scanner (dev / tests / no AV engine installed): detects EICAR only.
 * It is NOT an antivirus: a pass is reported as NOT_SCANNED so the UI never claims a file is clean.
 */
export class LocalSignatureScanner implements FileScanner {
  readonly name = 'local-eicar';
  async scan(data: Buffer): Promise<ScanVerdict> {
    if (data.includes(Buffer.from(EICAR, 'latin1'))) return { status: 'INFECTED', detail: 'EICAR-Test-File' };
    return { status: 'NOT_SCANNED', detail: 'no antivirus engine configured; local EICAR signature check only' };
  }
}

export class NoScanner implements FileScanner {
  readonly name = 'none';
  async scan(): Promise<ScanVerdict> {
    return { status: 'NOT_SCANNED', detail: 'scanning disabled' };
  }
}

/** ClamAV daemon over TCP (INSTREAM). Fail closed: an unreachable engine returns ERROR (the job retries, never READY-as-clean). */
export class ClamdScanner implements FileScanner {
  readonly name = 'clamd';
  constructor(private readonly host: string, private readonly port = 3310, private readonly timeoutMs = 20_000) {}
  scan(data: Buffer): Promise<ScanVerdict> {
    return new Promise((resolve) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      let out = '';
      const done = (v: ScanVerdict) => { sock.destroy(); resolve(v); };
      sock.setTimeout(this.timeoutMs, () => done({ status: 'ERROR', detail: 'clamd timeout' }));
      sock.on('error', (e) => done({ status: 'ERROR', detail: `clamd unavailable: ${e.message}` }));
      sock.on('data', (d) => { out += d.toString('utf8'); });
      sock.on('end', () => {
        if (/FOUND/.test(out)) done({ status: 'INFECTED', detail: out.replace(/^stream:\s*/, '').replace(/\s*FOUND.*/s, '').trim() });
        else if (/OK/.test(out)) done({ status: 'CLEAN', detail: 'clamd: OK' });
        else done({ status: 'ERROR', detail: `clamd unexpected response: ${out.slice(0, 80)}` });
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += 64 * 1024) {
          const chunk = data.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          sock.write(Buffer.concat([len, chunk]));
        }
        sock.write(Buffer.alloc(4));
      });
    });
  }
}

export function scannerFromEnv(env: NodeJS.ProcessEnv = process.env): FileScanner {
  const mode = env.FILE_SCANNER ?? (env.CLAMAV_HOST ? 'clamd' : 'local');
  if (mode === 'clamd') return new ClamdScanner(env.CLAMAV_HOST ?? '127.0.0.1', Number(env.CLAMAV_PORT ?? 3310));
  if (mode === 'none') return new NoScanner();
  return new LocalSignatureScanner();
}
