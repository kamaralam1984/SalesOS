import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import type { AuthedRequest } from '../../../common/authz';
import { AppError } from '../../../common/http/errors';
import { isMaintenanceExempt } from './maintenance.guard-logic';
import { MaintenanceService } from './maintenance.service';

/** While maintenance is ON, authenticated principals without devpanel:access get 503 MAINTENANCE. Runs after the guards, so request.principal exists. */
@Injectable()
export class MaintenanceInterceptor implements NestInterceptor {
  constructor(private readonly svc: MaintenanceService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const principal = req.principal;
    if (!principal || principal.permissions.has('devpanel:access')) return next.handle();
    if (isMaintenanceExempt(req.originalUrl ?? req.url)) return next.handle();
    const state = await this.svc.current(); // fails open internally
    if (!state.enabled) return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    let retry = 60;
    if (state.eta) {
      const s = Math.ceil((Date.parse(state.eta) - Date.now()) / 1000);
      if (s > 0) retry = Math.min(s, 300);
    }
    res.setHeader('Retry-After', String(retry));
    throw new AppError('MAINTENANCE', state.message ?? 'The app is under maintenance', 503, { eta: state.eta });
  }
}
