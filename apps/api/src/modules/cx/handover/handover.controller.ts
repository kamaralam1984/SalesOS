import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { acknowledgeHandoverSchema, completeHandoverSchema, createHandoverSchema, listHandoversQuerySchema, requestHandoverInfoSchema, updateHandoverSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { HandoverService } from './handover.service';

@ApiTags('handover')
@Controller('handovers')
export class HandoverController {
  constructor(private readonly svc: HandoverService) {}

  @Get()
  @RequirePermission('handover:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listHandoversQuerySchema)) q: z.infer<typeof listHandoversQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('template')
  @RequirePermission('handover:view')
  template(@CurrentUser() u: Principal) {
    return this.svc.template(u);
  }

  @Post()
  @RequirePermission('handover:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createHandoverSchema)) b: z.infer<typeof createHandoverSchema>) {
    return this.svc.create(u, b);
  }

  @Get(':id')
  @RequirePermission('handover:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('handover:create')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateHandoverSchema)) b: z.infer<typeof updateHandoverSchema>) {
    return this.svc.update(u, id, b);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('handover:create')
  submit(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submit(u, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermission('handover:acknowledge')
  acknowledge(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(acknowledgeHandoverSchema)) b: z.infer<typeof acknowledgeHandoverSchema>) {
    return this.svc.acknowledge(u, id, b);
  }

  @Post(':id/request-info')
  @HttpCode(200)
  @RequirePermission('handover:acknowledge')
  requestInfo(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(requestHandoverInfoSchema)) b: z.infer<typeof requestHandoverInfoSchema>) {
    return this.svc.requestInfo(u, id, b);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('handover:acknowledge')
  complete(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeHandoverSchema)) b: z.infer<typeof completeHandoverSchema>) {
    return this.svc.complete(u, id, b);
  }
}
