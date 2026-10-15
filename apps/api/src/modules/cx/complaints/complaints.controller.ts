import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { complaintTransitionSchema, complaintTrendsQuerySchema, createComplaintSchema, listComplaintsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { ComplaintsService } from './complaints.service';

@ApiTags('cx-complaints')
@Controller('cx/complaints')
export class ComplaintsController {
  constructor(private readonly svc: ComplaintsService) {}

  @Get()
  @RequirePermission('complaints:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listComplaintsQuerySchema)) q: z.infer<typeof listComplaintsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('trends')
  @RequirePermission('complaints:view')
  trends(@CurrentUser() u: Principal, @Query(new ZodPipe(complaintTrendsQuerySchema)) q: z.infer<typeof complaintTrendsQuerySchema>) {
    return this.svc.trends(u, q);
  }

  @Post()
  @RequirePermission('complaints:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createComplaintSchema)) b: z.infer<typeof createComplaintSchema>) {
    return this.svc.create(u, b);
  }

  @Get(':id')
  @RequirePermission('complaints:view')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission('complaints:update')
  transition(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(complaintTransitionSchema)) b: z.infer<typeof complaintTransitionSchema>) {
    return this.svc.transition(u, id, b);
  }
}
