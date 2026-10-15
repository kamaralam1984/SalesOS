import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createSuccessionPositionSchema, upsertSuccessionCandidateSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { SuccessionService } from './succession.service';

@ApiTags('people-succession')
@Controller('people/succession')
export class SuccessionController {
  constructor(private readonly svc: SuccessionService) {}

  @Get()
  @RequirePermission('succession:view')
  board(@CurrentUser() u: Principal) {
    return this.svc.board(u);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('succession:manage')
  upsertCandidate(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertSuccessionCandidateSchema)) b: z.infer<typeof upsertSuccessionCandidateSchema>) {
    return this.svc.upsertCandidate(u, b);
  }

  @Post('positions')
  @RequirePermission('succession:manage')
  createPosition(@CurrentUser() u: Principal, @Body(new ZodPipe(createSuccessionPositionSchema)) b: z.infer<typeof createSuccessionPositionSchema>) {
    return this.svc.createPosition(u, b);
  }

  @Delete('candidates/:id')
  @HttpCode(200)
  @RequirePermission('succession:manage')
  remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeCandidate(u, id);
  }
}
