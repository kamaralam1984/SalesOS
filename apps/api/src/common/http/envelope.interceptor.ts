import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiEnvelope } from '@salesos/shared-types';
import { ApiResult } from './api-result';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiEnvelope<unknown>> {
    const req = ctx.switchToHttp().getRequest<{ id?: string }>();
    return next.handle().pipe(
      map((value) => {
        const result = value instanceof ApiResult ? value : new ApiResult(value ?? null);
        return { data: result.data ?? null, meta: { ...result.meta, requestId: req.id }, error: null };
      }),
    );
  }
}
