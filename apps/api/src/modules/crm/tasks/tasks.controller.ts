import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { bulkAssignSchema, calendarQuerySchema, completeTaskSchema, createTaskSchema, listQueueQuerySchema, listTasksQuerySchema, reassignTaskSchema, updateTaskSchema } from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { QueuesService } from '../queues/queues.service';
import { TasksService } from './tasks.service';

@ApiTags('crm: tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('tasks:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listTasksQuerySchema)) q: z.infer<typeof listTasksQuerySchema>) {
    return this.tasks.list(u, q);
  }

  @Get('calendar')
  @RequirePermission('tasks:view')
  calendar(@CurrentUser() u: Principal, @Query(new ZodPipe(calendarQuerySchema)) q: z.infer<typeof calendarQuerySchema>) {
    return this.tasks.calendar(u, q);
  }

  @Post()
  @RequirePermission('tasks:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createTaskSchema)) b: z.infer<typeof createTaskSchema>, @Headers('idempotency-key') key?: string) {
    return this.tasks.create(u, b, undefined, key);
  }

  @Patch(':id')
  @RequirePermission('tasks:update')
  update(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateTaskSchema)) b: z.infer<typeof updateTaskSchema>) {
    return this.tasks.update(u, id, b);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('tasks:update')
  complete(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(completeTaskSchema)) b: z.infer<typeof completeTaskSchema>) {
    return this.tasks.complete(u, id, b);
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @RequirePermission('tasks:reassign')
  reassign(@CurrentUser() u: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(reassignTaskSchema)) b: z.infer<typeof reassignTaskSchema>) {
    return this.tasks.reassign(u, id, b);
  }
}

@ApiTags('crm: reassignment queue')
@Controller('reassignment-queue')
export class ReassignmentQueueController {
  constructor(private readonly queues: QueuesService) {}

  @Get()
  @RequirePermission('leads:exceptions:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listQueueQuerySchema)) q: z.infer<typeof listQueueQuerySchema>) {
    return this.queues.reassignmentQueue(u, q);
  }

  @Post('bulk-assign')
  @HttpCode(200)
  @RequirePermission('leads:reassignment-queue:resolve')
  bulkAssign(@CurrentUser() u: Principal, @Body(new ZodPipe(bulkAssignSchema)) b: z.infer<typeof bulkAssignSchema>) {
    return this.queues.bulkAssign(u, b);
  }
}
