import { Injectable } from '@nestjs/common';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Hist {
  buckets: number[];
  sum: number;
  count: number;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

/** Minimal Prometheus text-format registry (no dependency). Labels are low-cardinality: method, route TEMPLATE, status class/code. */
@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Hist>();
  private readonly startedAt = Date.now();
  private inFlight = 0;

  /** Express middleware: records count + latency once the response finishes. */
  readonly middleware = (
    req: { method: string; baseUrl?: string; route?: { path?: string } },
    res: { statusCode: number; on(ev: string, cb: () => void): void },
    next: () => void,
  ) => {
    const start = process.hrtime.bigint();
    this.inFlight++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.inFlight--;
      const route = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : 'unmatched';
      this.observe(req.method, route, res.statusCode, Number(process.hrtime.bigint() - start) / 1e9);
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };

  observe(method: string, route: string, status: number, seconds: number) {
    const rk = `${method}\u0000${route}\u0000${status}`;
    this.requests.set(rk, (this.requests.get(rk) ?? 0) + 1);
    const dk = `${method}\u0000${route}`;
    let h = this.durations.get(dk);
    if (!h) this.durations.set(dk, (h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h!.buckets[i]!++;
    });
    h.sum += seconds;
    h.count++;
  }

  /** `extra` = gauges collected at scrape time (db/redis/outbox/worker). */
  render(extra: Array<{ name: string; help: string; value: number; labels?: Record<string, string> }> = []): string {
    const out: string[] = [];
    out.push('# HELP salesos_http_requests_total HTTP requests by method, route template and status.', '# TYPE salesos_http_requests_total counter');
    for (const [k, v] of this.requests) {
      const [m, r, s] = k.split('\u0000');
      out.push(`salesos_http_requests_total{method="${m}",route="${esc(r!)}",status="${s}"} ${v}`);
    }
    out.push('# HELP salesos_http_request_duration_seconds HTTP request latency.', '# TYPE salesos_http_request_duration_seconds histogram');
    for (const [k, h] of this.durations) {
      const [m, r] = k.split('\u0000');
      const l = `method="${m}",route="${esc(r!)}"`;
      BUCKETS.forEach((b, i) => out.push(`salesos_http_request_duration_seconds_bucket{${l},le="${b}"} ${h.buckets[i]}`));
      out.push(`salesos_http_request_duration_seconds_bucket{${l},le="+Inf"} ${h.count}`, `salesos_http_request_duration_seconds_sum{${l}} ${h.sum}`, `salesos_http_request_duration_seconds_count{${l}} ${h.count}`);
    }
    const mem = process.memoryUsage();
    const gauges: Array<[string, string, number]> = [
      ['salesos_http_requests_in_flight', 'In-flight HTTP requests.', this.inFlight],
      ['salesos_process_uptime_seconds', 'Process uptime.', (Date.now() - this.startedAt) / 1000],
      ['salesos_process_resident_memory_bytes', 'Resident set size.', mem.rss],
      ['salesos_process_heap_used_bytes', 'V8 heap used.', mem.heapUsed],
      ['salesos_process_cpu_seconds_total', 'User+system CPU time.', (process.cpuUsage().user + process.cpuUsage().system) / 1e6],
    ];
    for (const [n, h, v] of gauges) out.push(`# HELP ${n} ${h}`, `# TYPE ${n} gauge`, `${n} ${v}`);
    const seen = new Set<string>();
    for (const g of extra) {
      if (!seen.has(g.name)) {
        out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
        seen.add(g.name);
      }
      const lbl = g.labels ? `{${Object.entries(g.labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : '';
      out.push(`${g.name}${lbl} ${g.value}`);
    }
    return out.join('\n') + '\n';
  }
}
