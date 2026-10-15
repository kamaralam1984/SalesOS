import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden } from '../http/errors';
import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRE_ALL, REQUIRE_ANY } from './decorators';
import type { AuthedRequest } from './principal';

/**
 * DENY BY DEFAULT. A route is reachable only if it declares one of:
 * @Public(), @Authenticated(), @RequirePermission(...), @RequireAnyPermission(...).
 * Anything else is rejected with 403 (and a test fails the suite, see deny-by-default.spec.ts).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const principal = req.principal;
    if (!principal) throw forbidden();

    const all = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_ALL, targets);
    const any = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_ANY, targets);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets);

    if (!all?.length && !any?.length && !authenticatedOnly) {
      this.logger.error(`Route ${ctx.getClass().name}.${ctx.getHandler().name} has no permission metadata; denied`);
      throw forbidden();
    }
    if (all?.length && !all.every((k) => principal.permissions.has(k))) throw forbidden();
    if (any?.length && !any.some((k) => principal.permissions.has(k))) throw forbidden();
    return true;
  }
}
