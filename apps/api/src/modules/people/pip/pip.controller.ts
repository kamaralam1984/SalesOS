import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createPipSchema, listPipsQuerySchema, pipApproveSchema, pipTransitionSchema, updateCheckpointSchema, updatePipDraftSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PipService } from './pip.service';

@ApiTags('people-pip')
@Controller('people/pips')
export class PipController {
  constructor(private readonly svc: PipService) {}

  @Get()
  @RequirePermission('pip:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listPipsQuerySchema)) q: z.infer<typeof listPipsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post()
  @RequirePermission('pip:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createPipSchema)) b: z.infer<typeof createPipSchema>) {
    return this.svc.create(u, b);
  }

  @Post('propose')
  @RequirePermission('pip:propose')
  propose(@CurrentUser() u: Principal, @Body(new ZodPipe(createPipSchema)) b: z.infer<typeof createPipSchema>) {
    return this.svc.propose(u, b);
  }

  @Get(':id')
  @RequirePermission('pip:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('pip:update')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updatePipDraftSchema)) b: z.infer<typeof updatePipDraftSchema>) {
    return this.svc.updateDraft(u, id, b);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequireAnyPermission('pip:update', 'pip:approve')
  transition(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pipTransitionSchema)) b: z.infer<typeof pipTransitionSchema>) {
    return this.svc.transition(u, id, b);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('pip:approve')
  approve(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pipApproveSchema)) b: z.infer<typeof pipApproveSchema>) {
    return this.svc.approve(u, id, b);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermission('pip:view')
  acknowledge(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.acknowledge(u, id);
  }

  @Patch(':id/checkpoints/:cid')
  @RequirePermission('pip:update')
  checkpoint(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string, @Body(new ZodPipe(updateCheckpointSchema)) b: z.infer<typeof updateCheckpointSchema>) {
    return this.svc.updateCheckpoint(u, id, cid, b);
  }
}
