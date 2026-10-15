import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createWorkTaskSchema, listWorkTasksQuerySchema, updateWorkTaskSchema, workTaskCommentSchema, workTaskTransitionSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { TasksService } from './tasks.service';

@ApiTags('workforce-tasks')
@Controller('workforce/tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Post()
  @RequirePermission('work-tasks:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createWorkTaskSchema)) b: z.infer<typeof createWorkTaskSchema>) {
    return this.svc.create(u, b);
  }

  @Get()
  @RequirePermission('work-tasks:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listWorkTasksQuerySchema)) q: z.infer<typeof listWorkTasksQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('summary')
  @RequirePermission('work-tasks:view')
  summary(@CurrentUser() u: Principal) {
    return this.svc.summary(u);
  }

  @Get(':id')
  @RequirePermission('work-tasks:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('work-tasks:update')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateWorkTaskSchema)) b: z.infer<typeof updateWorkTaskSchema>) {
    return this.svc.update(u, id, b);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission('work-tasks:update')
  transition(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(workTaskTransitionSchema)) b: z.infer<typeof workTaskTransitionSchema>) {
    return this.svc.transition(u, id, b);
  }

  @Post(':id/comment')
  @RequirePermission('work-tasks:update')
  comment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(workTaskCommentSchema)) b: z.infer<typeof workTaskCommentSchema>) {
    return this.svc.comment(u, id, b);
  }
}
