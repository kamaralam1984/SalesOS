import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { assignResourceSchema, createResourceSchema, listResourcesQuerySchema, updateAssignmentSchema } from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { ResourcesService } from './resources.service';

const assignmentsQuery = z.object({ userId: z.string().uuid().optional(), status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']).optional() });

@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(private readonly svc: ResourcesService) {}

  @Get()
  @RequirePermission('resources:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listResourcesQuerySchema)) q: z.infer<typeof listResourcesQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post()
  @RequirePermission('resources:manage')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createResourceSchema)) b: z.infer<typeof createResourceSchema>) {
    return this.svc.create(u, b);
  }

  @Get('assignments')
  @RequirePermission('resources:view')
  assignments(@CurrentUser() u: Principal, @Query(new ZodPipe(assignmentsQuery)) q: z.infer<typeof assignmentsQuery>) {
    return this.svc.assignments(u, q);
  }

  @Patch('assignments/:id')
  @RequirePermission('resources:view')
  updateAssignment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateAssignmentSchema)) b: z.infer<typeof updateAssignmentSchema>) {
    return this.svc.updateAssignment(u, id, b);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('resources:manage')
  assign(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assignResourceSchema)) b: z.infer<typeof assignResourceSchema>) {
    return this.svc.assign(u, id, b);
  }
}
