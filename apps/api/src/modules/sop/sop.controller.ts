import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adoptionQuerySchema, approveSopSchema, createGapSchema, createSopSchema, createSopVersionSchema, listGapsQuerySchema, listSopQuerySchema, rejectSopSchema, updateGapSchema, updateSopDraftSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { SopService } from './sop.service';

const uuid = () => new ParseUUIDPipe();

@ApiTags('sop')
@Controller('sop')
export class SopController {
  constructor(private readonly sop: SopService) {}

  @Get()
  @RequirePermission('sop:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listSopQuerySchema)) q: z.infer<typeof listSopQuerySchema>) {
    return this.sop.list(u, q);
  }

  @Post()
  @RequirePermission('sop:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createSopSchema)) b: z.infer<typeof createSopSchema>) {
    return this.sop.create(u, b);
  }

  @Get('adoption')
  @RequirePermission('sop:adoption:view')
  adoption(@CurrentUser() u: Principal, @Query(new ZodPipe(adoptionQuerySchema)) q: z.infer<typeof adoptionQuerySchema>) {
    return this.sop.adoption(u, q);
  }

  @Get('gaps')
  @RequirePermission('sop:gaps:view')
  gaps(@CurrentUser() u: Principal, @Query(new ZodPipe(listGapsQuerySchema)) q: z.infer<typeof listGapsQuerySchema>) {
    return this.sop.listGaps(u, q);
  }

  @Post('gaps')
  @RequirePermission('sop:gaps:manage')
  createGap(@CurrentUser() u: Principal, @Body(new ZodPipe(createGapSchema)) b: z.infer<typeof createGapSchema>) {
    return this.sop.createGap(u, b);
  }

  @Patch('gaps/:id')
  @RequirePermission('sop:gaps:manage')
  updateGap(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateGapSchema)) b: z.infer<typeof updateGapSchema>) {
    return this.sop.updateGap(u, id, b);
  }

  @Get('versions/:id')
  @RequirePermission('sop:view')
  version(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.getVersion(u, id);
  }

  @Patch('versions/:id')
  @RequirePermission('sop:create')
  updateDraft(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateSopDraftSchema)) b: z.infer<typeof updateSopDraftSchema>) {
    return this.sop.updateDraft(u, id, b);
  }

  @Post('versions/:id/submit')
  @HttpCode(200)
  @RequirePermission('sop:create')
  submit(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.submit(u, id);
  }

  @Post('versions/:id/approve')
  @HttpCode(200)
  @RequirePermission('sop:approve')
  approve(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(approveSopSchema)) b: z.infer<typeof approveSopSchema>) {
    return this.sop.approve(u, id, b);
  }

  @Post('versions/:id/reject')
  @HttpCode(200)
  @RequirePermission('sop:approve')
  reject(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(rejectSopSchema)) b: z.infer<typeof rejectSopSchema>) {
    return this.sop.reject(u, id, b.reason);
  }

  @Post('versions/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('sop:acknowledge')
  acknowledge(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.acknowledge(u, id);
  }

  @Post('versions/:id/remind')
  @HttpCode(200)
  @RequirePermission('sop:create', 'sop:adoption:view')
  remind(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.remind(u, id);
  }

  @Get(':id')
  @RequirePermission('sop:view')
  get(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.get(u, id);
  }

  @Get(':id/versions')
  @RequirePermission('sop:view')
  async versions(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return (await this.sop.get(u, id)).versions;
  }

  @Post(':id/versions')
  @RequirePermission('sop:create')
  createVersion(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(createSopVersionSchema)) b: z.infer<typeof createSopVersionSchema>) {
    return this.sop.createVersion(u, id, b);
  }

  @Post(':id/retire')
  @HttpCode(200)
  @RequirePermission('sop:approve')
  retire(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.retire(u, id);
  }

  @Get(':id/acknowledgements')
  @RequirePermission('sop:adoption:view')
  acknowledgements(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.sop.acknowledgementHistory(u, id);
  }
}
