import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ok } from '../../../common/http/api-result';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Limited } from '../../../common/security/rate-limits';
import { DiagnosticsService } from './diagnostics.service';

const jobsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(200).optional() });
const errorsQuery = z.object({ kind: z.enum(['all', 'error', 'slow']).default('all'), limit: z.coerce.number().int().min(1).max(200).default(50) });
const discardBody = z.object({ reason: z.string().trim().min(3).max(300) });

@ApiTags('dev-panel: diagnostics')
@Controller('dev-panel/diagnostics')
export class DiagnosticsController {
  constructor(private readonly svc: DiagnosticsService) {}

  @Get('health')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view')
  async health() {
    return ok(await this.svc.health());
  }

  @Get('jobs')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view')
  async jobs(@CurrentUser() u: Principal, @Query(new ZodPipe(jobsQuery)) q: z.infer<typeof jobsQuery>) {
    const r = await this.svc.listJobs(u, q);
    return ok(r.data, r.meta);
  }

  @Post('jobs/retry-all')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view', 'devpanel:jobs:manage')
  retryAll(@CurrentUser() u: Principal) {
    return this.svc.retryAll(u);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view', 'devpanel:jobs:manage')
  retry(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.retry(u, id);
  }

  @Post('jobs/:id/discard')
  @HttpCode(200)
  @Limited('ADMIN_ACTION')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view', 'devpanel:jobs:manage')
  discard(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(discardBody)) b: z.infer<typeof discardBody>) {
    return this.svc.discard(u, id, b.reason);
  }

  @Get('errors')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view')
  errors(@Query(new ZodPipe(errorsQuery)) q: z.infer<typeof errorsQuery>) {
    return this.svc.errors(q.kind, q.limit);
  }

  @Get('migrations')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view')
  migrations() {
    return this.svc.migrations();
  }

  @Get('build')
  @RequirePermission('devpanel:access', 'devpanel:diagnostics:view')
  build() {
    return this.svc.build();
  }
}
