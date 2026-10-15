import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { updateOrgSettingsSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { OrgService } from './org.service';

@ApiTags('org')
@Controller('org/settings')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get()
  @RequirePermission('settings:view')
  get(@CurrentUser() user: Principal) {
    return this.org.getOrg(user.organizationId);
  }

  @Patch()
  @RequirePermission('settings:update')
  async update(@CurrentUser() user: Principal, @Body(new ZodPipe(updateOrgSettingsSchema)) body: z.infer<typeof updateOrgSettingsSchema>) {
    return { settings: await this.org.update(user, body) };
  }
}
