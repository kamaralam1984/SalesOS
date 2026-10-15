import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createAnnouncementSchema, listAnnouncementsQuerySchema, listDirectoryQuerySchema, orgChartQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { AnnouncementsService } from './announcements.service';
import { DashboardService } from './dashboard.service';
import { DirectoryService } from './directory.service';
import { OrgChartService } from './org-chart.service';

@ApiTags('workforce-directory')
@Controller('workforce/directory')
export class DirectoryController {
  constructor(private readonly svc: DirectoryService) {}

  @Get()
  @RequirePermission('directory:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listDirectoryQuerySchema)) q: z.infer<typeof listDirectoryQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Get('departments')
  @RequirePermission('directory:view')
  departments(@CurrentUser() u: Principal) {
    return this.svc.departments(u);
  }

  @Get(':userId')
  @RequirePermission('directory:view')
  get360(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.get360(u, userId);
  }
}

@ApiTags('workforce-directory')
@Controller('workforce/org-chart')
export class OrgChartController {
  constructor(private readonly svc: OrgChartService) {}

  @Get()
  @RequirePermission('directory:view')
  get(@CurrentUser() u: Principal, @Query(new ZodPipe(orgChartQuerySchema)) q: z.infer<typeof orgChartQuerySchema>) {
    return this.svc.get(u, q);
  }
}

@ApiTags('workforce-dashboard')
@Controller('workforce/dashboard')
export class WorkforceDashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  @RequirePermission('workforce:dashboard:view')
  get(@CurrentUser() u: Principal) {
    return this.svc.get(u);
  }
}

@ApiTags('workforce-announcements')
@Controller('workforce/announcements')
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  @RequirePermission('announcements:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listAnnouncementsQuerySchema)) q: z.infer<typeof listAnnouncementsQuerySchema>) {
    return this.svc.list(u, q);
  }

  @Post()
  @RequirePermission('announcements:manage')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createAnnouncementSchema)) b: z.infer<typeof createAnnouncementSchema>) {
    return this.svc.create(u, b);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('announcements:manage')
  remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
}
