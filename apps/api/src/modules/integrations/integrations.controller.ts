import { Limited } from '../../common/security/rate-limits';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { consentUpsertSchema, integrationTestSchema, deliveryListQuerySchema, integrationPatchSchema, paginationQuerySchema, type IntegrationPatch, type PaginationQuery } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ok } from '../../common/http/api-result';
import { ZodPipe } from '../../common/http/zod.pipe';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get()
  @RequirePermission('integrations:manage')
  list(@CurrentUser() user: Principal) {
    return this.svc.list(user.organizationId);
  }

  @Get('health')
  @RequirePermission('integrations:manage')
  health(@CurrentUser() user: Principal) {
    return this.svc.healthSummary(user.organizationId);
  }

  @Get('failures')
  @RequirePermission('integrations:manage')
  failures(@CurrentUser() user: Principal) {
    return this.svc.failures(user.organizationId);
  }

  @Get('deliveries')
  @RequirePermission('integrations:manage')
  async deliveries(@CurrentUser() user: Principal, @Query(new ZodPipe(deliveryListQuerySchema)) q: z.infer<typeof deliveryListQuerySchema>) {
    const r = await this.svc.listDeliveries(user.organizationId, q);
    return ok(r.data, r.meta);
  }

  @Get('deliveries/:id')
  @RequirePermission('integrations:manage')
  delivery(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getDelivery(user.organizationId, id);
  }

  @Post('deliveries/:id/retry')
  @RequirePermission('integrations:manage')
  retry(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retryDelivery(user, id);
  }

  @Get('consent')
  @RequirePermission('integrations:manage')
  async consent(@CurrentUser() user: Principal, @Query(new ZodPipe(paginationQuerySchema)) q: PaginationQuery) {
    const r = await this.svc.listConsent(user.organizationId, q);
    return ok(r.data, r.meta);
  }

  @Put('consent')
  @RequirePermission('integrations:manage')
  upsertConsent(@CurrentUser() user: Principal, @Body(new ZodPipe(consentUpsertSchema)) body: z.infer<typeof consentUpsertSchema>) {
    return this.svc.upsertConsent(user, body);
  }

  @Patch(':provider')
  @RequirePermission('integrations:manage')
  patch(@CurrentUser() user: Principal, @Param('provider') provider: string, @Body(new ZodPipe(integrationPatchSchema)) body: IntegrationPatch) {
    return this.svc.patch(user, provider, body);
  }

  @Limited('ADMIN_ACTION')
  @Post(':provider/test')
  @RequirePermission('integrations:manage')
  test(@CurrentUser() user: Principal, @Param('provider') provider: string, @Body(new ZodPipe(integrationTestSchema)) body: z.infer<typeof integrationTestSchema>) {
    return this.svc.sendTest(user, provider, body);
  }

  @Post(':provider/health')
  @RequirePermission('integrations:manage')
  check(@CurrentUser() user: Principal, @Param('provider') provider: string) {
    return this.svc.checkHealth(user, provider);
  }
}
