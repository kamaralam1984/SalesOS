import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PermissionKey } from './permissions.catalogue';
import type { Principal } from './principal';

export const IS_PUBLIC = 'authz:public';
export const IS_AUTHENTICATED = 'authz:authenticated';
export const REQUIRE_ALL = 'authz:require-all';
export const REQUIRE_ANY = 'authz:require-any';

/** No authentication at all (login, health, ...). Use sparingly; the meta test lists every use. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any logged-in user (e.g. /auth/me). Prefer RequirePermission for anything touching business data. */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);
/** Caller must hold ALL listed permissions. */
export const RequirePermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRE_ALL, keys);
/** Caller must hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRE_ANY, keys);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<{ principal: Principal }>().principal;
});
