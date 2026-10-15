import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createRecognitionProgramSchema, createRecognitionSchema, listRecognitionsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { RecognitionService } from './recognition.service';

@ApiTags('people-recognition')
@Controller('people')
export class RecognitionController {
  constructor(private readonly svc: RecognitionService) {}

  @Get('recognition-programs')
  @RequirePermission('recognition:view')
  programs(@CurrentUser() u: Principal) {
    return this.svc.programs(u);
  }

  @Post('recognition-programs')
  @RequirePermission('recognition:create')
  createProgram(@CurrentUser() u: Principal, @Body(new ZodPipe(createRecognitionProgramSchema)) b: z.infer<typeof createRecognitionProgramSchema>) {
    return this.svc.createProgram(u, b);
  }

  @Get('recognitions')
  @RequirePermission('recognition:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listRecognitionsQuerySchema)) q: z.infer<typeof listRecognitionsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post('recognitions')
  @RequirePermission('recognition:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createRecognitionSchema)) b: z.infer<typeof createRecognitionSchema>) {
    return this.svc.create(u, b);
  }
}
