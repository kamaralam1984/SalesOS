import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ROLE_KEYS } from '@salesos/shared-types';
import { RequirePermission } from '../../../common/authz';
import { catalogueEntries } from '../../../common/authz/permissions.catalogue';

@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  @Get('catalogue')
  @RequirePermission('users:role:assign')
  catalogue() {
    return { roles: ROLE_KEYS, permissions: catalogueEntries() };
  }
}
