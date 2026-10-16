import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { ERROR_BUFFER_SIZE, SLOW_REQUEST_MS } from './diagnostics.constants';

export interface RequestRecord {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  requestId: string | null;
  at: string;
  kind: 'error' | 'slow';
}

/** Bounded per-process ring buffer of 5xx and slow requests. Resets on restart. Stores NO bodies, headers, query strings or user data. */
@Injectable()
export class ErrorBufferService {
  private readonly items: RequestRecord[] = [];
  readonly startedAt = new Date().toISOString();

  record(r: { method: string; route: string; status: number; durationMs: number; requestId?: string | null }) {
    const isError = r.status >= 500;
    const isSlow = r.durationMs >= SLOW_REQUEST_MS;
    if (!isError && !isSlow) return;
    this.items.push({
      method: r.method.slice(0, 10),
      route: r.route.split('?')[0]!.slice(0, 200),
      status: r.status,
      durationMs: Math.round(r.durationMs),
      requestId: r.requestId ? String(r.requestId).slice(0, 80) : null,
      at: new Date().toISOString(),
      kind: isError ? 'error' : 'slow',
    });
    if (this.items.length > ERROR_BUFFER_SIZE) this.items.splice(0, this.items.length - ERROR_BUFFER_SIZE);
  }

  list(kind: 'all' | 'error' | 'slow', limit: number): RequestRecord[] {
    const src = kind === 'all' ? this.items : this.items.filter((i) => i.kind === kind);
    return src.slice(-limit).reverse();
  }

  size() {
    return this.items.length;
  }
}

interface Req { method: string; id?: string; baseUrl?: string; route?: { path?: unknown } }
interface Res { statusCode: number; on(ev: string, cb: () => void): void }

@Injectable()
export class RequestCaptureInterceptor implements NestInterceptor {
  constructor(private readonly buf: ErrorBufferService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Res>();
    const start = process.hrtime.bigint();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const route = typeof req.route?.path === 'string' ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
      this.buf.record({ method: req.method, route, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - start) / 1e6, requestId: req.id });
    };
    res.on('finish', finish);
    res.on('close', finish);
    return next.handle();
  }
}
