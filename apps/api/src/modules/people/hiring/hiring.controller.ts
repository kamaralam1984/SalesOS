import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCandidateSchema, createInterviewFeedbackSchema, createRequisitionSchema, listRequisitionsQuerySchema, moveCandidateSchema, updateRequisitionSchema, upsertEmployeeProfileSchema, upsertRoleProfileSchema,
} from '@salesos/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { HiringService } from './hiring.service';

const candidatesQuery = listRequisitionsQuerySchema.extend({ requisitionId: z.string().uuid().optional() });

@ApiTags('people-hiring')
@Controller('people')
export class HiringController {
  constructor(private readonly svc: HiringService) {}

  @Get('hiring')
  @RequirePermission('hiring:view')
  pipeline(@CurrentUser() u: Principal, @Query(new ZodPipe(listRequisitionsQuerySchema)) q: z.infer<typeof listRequisitionsQuerySchema>) {
    return this.svc.pipeline(u, q);
  }

  @Post('hiring')
  @RequirePermission('hiring:manage')
  createRequisition(@CurrentUser() u: Principal, @Body(new ZodPipe(createRequisitionSchema)) b: z.infer<typeof createRequisitionSchema>) {
    return this.svc.createRequisition(u, b);
  }

  @Get('hiring/profiles')
  @RequirePermission('hiring:view')
  profiles(@CurrentUser() u: Principal) {
    return this.svc.listProfiles(u);
  }

  @Put('hiring/profiles')
  @RequirePermission('hiring:manage')
  upsertProfile(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertRoleProfileSchema)) b: z.infer<typeof upsertRoleProfileSchema>) {
    return this.svc.upsertProfile(u, b);
  }

  @Get('hiring/candidates')
  @RequirePermission('hiring:view')
  candidates(@CurrentUser() u: Principal, @Query(new ZodPipe(candidatesQuery)) q: z.infer<typeof candidatesQuery>) {
    return this.svc.listCandidates(u, q.requisitionId, q);
  }

  @Post('hiring/candidates')
  @RequirePermission('hiring:manage')
  createCandidate(@CurrentUser() u: Principal, @Body(new ZodPipe(createCandidateSchema)) b: z.infer<typeof createCandidateSchema>) {
    return this.svc.createCandidate(u, b);
  }

  @Get('hiring/candidates/:id')
  @RequirePermission('hiring:view')
  candidate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getCandidate(u, id);
  }

  @Post('hiring/candidates/:id/stage')
  @HttpCode(200)
  @RequirePermission('hiring:manage')
  moveCandidate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(moveCandidateSchema)) b: z.infer<typeof moveCandidateSchema>) {
    return this.svc.moveCandidate(u, id, b);
  }

  @Post('hiring/candidates/:id/feedback')
  @RequirePermission('hiring:manage')
  addFeedback(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createInterviewFeedbackSchema)) b: z.infer<typeof createInterviewFeedbackSchema>) {
    return this.svc.addFeedback(u, id, b);
  }

  @Patch('hiring/:id')
  @RequirePermission('hiring:manage')
  updateRequisition(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateRequisitionSchema)) b: z.infer<typeof updateRequisitionSchema>) {
    return this.svc.updateRequisition(u, id, b);
  }

  @Get('employees')
  @RequirePermission('hr:records:view')
  employees(@CurrentUser() u: Principal, @Query(new ZodPipe(listRequisitionsQuerySchema)) q: z.infer<typeof listRequisitionsQuerySchema>) {
    return this.svc.listEmployees(u, q);
  }

  @Get('employees/:id')
  @RequirePermission('hr:records:view')
  employee(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getEmployee(u, id);
  }

  @Put('employees/:id')
  @RequirePermission('hr:records:manage')
  saveEmployee(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(upsertEmployeeProfileSchema)) b: z.infer<typeof upsertEmployeeProfileSchema>) {
    return this.svc.upsertEmployee(u, id, b);
  }
}
