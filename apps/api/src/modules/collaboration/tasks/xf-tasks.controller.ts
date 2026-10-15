import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createXfTaskSchema, listXfTasksQuerySchema, updateXfTaskSchema, xfCommentSchema, xfDependencySchema } from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { XfTasksService } from './xf-tasks.service';

const assigneesQuery = z.object({ department: z.enum(['FOUNDER', 'SALES', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS']) });
const escalateBody = z.object({ reason: z.string().trim().min(3).max(1000) });

@ApiTags('collaboration')
@Controller('xf-tasks')
export class XfTasksController {
  constructor(private readonly svc: XfTasksService) {}

  @Get()
  @RequirePermission('xf-tasks:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listXfTasksQuerySchema)) q: z.infer<typeof listXfTasksQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('assignees')
  @RequirePermission('xf-tasks:create')
  assignees(@CurrentUser() u: Principal, @Query(new ZodPipe(assigneesQuery)) q: z.infer<typeof assigneesQuery>) {
    return this.svc.assignees(u, q.department);
  }

  @Post()
  @RequirePermission('xf-tasks:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createXfTaskSchema)) b: z.infer<typeof createXfTaskSchema>) {
    return this.svc.create(u, b);
  }

  @Get(':id')
  @RequirePermission('xf-tasks:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('xf-tasks:update')
  update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateXfTaskSchema)) b: z.infer<typeof updateXfTaskSchema>) {
    return this.svc.update(u, id, b);
  }

  @Post(':id/comments')
  @RequirePermission('xf-tasks:update')
  comment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(xfCommentSchema)) b: z.infer<typeof xfCommentSchema>) {
    return this.svc.comment(u, id, b);
  }

  @Post(':id/dependencies')
  @HttpCode(200)
  @RequirePermission('xf-tasks:update')
  addDependency(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(xfDependencySchema)) b: z.infer<typeof xfDependencySchema>) {
    return this.svc.addDependency(u, id, b);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission('xf-tasks:update')
  confirm(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(u, id);
  }

  @Post(':id/escalate')
  @HttpCode(200)
  @RequirePermission('xf-tasks:update')
  escalate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(escalateBody)) b: z.infer<typeof escalateBody>) {
    return this.svc.escalate(u, id, b.reason);
  }
}
