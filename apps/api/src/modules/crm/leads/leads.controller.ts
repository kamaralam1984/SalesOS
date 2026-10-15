import { Limited } from '../../../common/security/rate-limits';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  assignLeadSchema, attendanceSchema, bulkAssignSchema, changeStatusSchema, createLeadSchema, createNoteSchema, createTaskSchema, dismissDuplicateSchema, importErrorsQuerySchema, listLeadsQuerySchema, listQueueQuerySchema,
  logCallSchema, mergeDuplicateSchema, paginationQuerySchema, reactivateSchema, resolveExceptionSchema, savedViewSchema, timelineQuerySchema, updateLeadSchema,
} from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { CallsService } from '../calls/calls.service';
import { CrmSupport } from '../crm.support';
import { EventsService } from '../events/events.service';
import { ImportsService, readImportBody } from '../imports/imports.service';
import { QueuesService } from '../queues/queues.service';
import { TasksService } from '../tasks/tasks.service';
import { DuplicatesService } from './duplicates.service';
import { LeadsService } from './leads.service';
import { OBJECTIONS, OUTCOMES, TASK_TYPES } from './meta';

const uuid = () => new ParseUUIDPipe();
const eventLinkSchema = attendanceSchema.omit({ leadId: true }).extend({ eventId: z.string().uuid() });
const reactivationQuery = listQueueQuerySchema.extend({ eligibleOnly: z.coerce.boolean().optional() });

/**
 * Static `/leads/...` routes. MUST be registered before LeadsController (`:id`) - see CrmModule controller order.
 */
@ApiTags('crm: leads (queues, imports, workspace)')
@Controller('leads')
export class LeadsStaticController {
  constructor(
    private readonly s: CrmSupport,
    private readonly leads: LeadsService,
    private readonly dups: DuplicatesService,
    private readonly imports: ImportsService,
    private readonly queues: QueuesService,
  ) {}

  @Get()
  @RequirePermission('leads:view')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(listLeadsQuerySchema)) q: z.infer<typeof listLeadsQuerySchema>) {
    return this.leads.list(u, q);
  }

  @Post()
  @RequirePermission('leads:create')
  create(@CurrentUser() u: Principal, @Body(new ZodPipe(createLeadSchema)) b: z.infer<typeof createLeadSchema>, @Headers('idempotency-key') key?: string) {
    return this.leads.create(u, b, key);
  }

  @Limited('EXPORT')
  @Get('export')
  @RequirePermission('leads:export')
  async exportLeads(@CurrentUser() u: Principal, @Query(new ZodPipe(listLeadsQuerySchema)) q: z.infer<typeof listLeadsQuerySchema>, @Res() res: Response) {
    const out = await this.leads.exportCsv(u, q);
    res.status(200).type('text/csv').setHeader('content-disposition', 'attachment; filename="leads.csv"');
    res.setHeader('x-export-rows', String(out.rows));
    res.setHeader('x-export-truncated', String(out.truncated));
    res.send(out.csv);
  }

  @Get('ageing')
  @RequirePermission('leads:view')
  ageing(@CurrentUser() u: Principal) {
    return this.leads.ageing(u);
  }

  @Get('workspace')
  @RequirePermission('leads:view')
  workspace(@CurrentUser() u: Principal) {
    return this.leads.workspace(u);
  }

  /** Lookup bundle for forms (stages, lost reasons, sources, programs, enums) so executives need no settings permission. */
  @Get('meta')
  @RequirePermission('leads:view')
  async meta(@CurrentUser() u: Principal) {
    const org = u.organizationId;
    const [stages, lostReasons, sources, programs] = await Promise.all([
      this.s.prisma.leadStageConfig.findMany({ where: { organizationId: org, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { key: true, label: true, category: true, sortOrder: true } }),
      this.s.prisma.lostReasonConfig.findMany({ where: { organizationId: org, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { key: true, label: true, requiresNote: true } }),
      this.s.prisma.leadSource.findMany({ where: { organizationId: org, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true } }),
      this.s.prisma.program.findMany({ where: { organizationId: org, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, kind: true } }),
    ]);
    return { stages, lostReasons, sources, programs, callOutcomes: OUTCOMES, objectionCategories: OBJECTIONS, taskTypes: TASK_TYPES };
  }

  @Get('exceptions')
  @RequirePermission('leads:exceptions:view')
  exceptions(@CurrentUser() u: Principal, @Query(new ZodPipe(listQueueQuerySchema)) q: z.infer<typeof listQueueQuerySchema>) {
    return this.queues.exceptions(u, q);
  }

  @Post('exceptions/:id/resolve')
  @HttpCode(200)
  @RequirePermission('leads:reassignment-queue:resolve')
  resolveException(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(resolveExceptionSchema)) b: z.infer<typeof resolveExceptionSchema>) {
    return this.queues.resolveException(u, id, b);
  }

  @Get('duplicates')
  @RequirePermission('leads:duplicates:review')
  duplicates(@CurrentUser() u: Principal, @Query(new ZodPipe(paginationQuerySchema.extend({ status: z.enum(['OPEN', 'MERGED', 'DISMISSED']).optional() }))) q: { limit?: number; cursor?: string; page?: number; status?: 'OPEN' | 'MERGED' | 'DISMISSED' }) {
    return this.dups.list(u, q);
  }

  @Post('duplicates/:id/merge')
  @HttpCode(200)
  @RequirePermission('leads:duplicates:review')
  merge(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(mergeDuplicateSchema)) b: z.infer<typeof mergeDuplicateSchema>) {
    return this.dups.merge(u, id, b);
  }

  @Post('duplicates/:id/dismiss')
  @HttpCode(200)
  @RequirePermission('leads:duplicates:review')
  dismiss(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(dismissDuplicateSchema)) b: z.infer<typeof dismissDuplicateSchema>) {
    return this.dups.dismiss(u, id, b);
  }

  @Get('reactivation')
  @RequirePermission('leads:reactivation:view')
  reactivation(@CurrentUser() u: Principal, @Query(new ZodPipe(reactivationQuery)) q: z.infer<typeof reactivationQuery>) {
    return this.queues.reactivationQueue(u, q);
  }

  @Post('reactivation/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('leads:assign')
  reactivate(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(reactivateSchema)) b: z.infer<typeof reactivateSchema>) {
    return this.queues.reactivate(u, id, b);
  }

  // ---- imports --------------------------------------------------------------------------------------------------
  @Limited('IMPORT')
  @Post('import/preview')
  @HttpCode(200)
  @RequirePermission('leads:import')
  async importPreview(@Req() req: Request) {
    return this.imports.preview(await readImportBody(req));
  }

  @Limited('IMPORT')
  @Post('import')
  @RequirePermission('leads:import')
  async importCsv(@CurrentUser() u: Principal, @Req() req: Request, @Headers('idempotency-key') key?: string) {
    return this.imports.create(u, await readImportBody(req), key);
  }

  @Get('import')
  @RequirePermission('imports:view')
  importList(@CurrentUser() u: Principal, @Query(new ZodPipe(paginationQuerySchema)) q: { limit?: number; cursor?: string; page?: number }) {
    return this.imports.list(u, q);
  }

  @Get('import/:jobId')
  @RequirePermission('imports:view')
  importGet(@CurrentUser() u: Principal, @Param('jobId', uuid()) id: string) {
    return this.imports.get(u, id);
  }

  @Get('import/:jobId/errors')
  @RequirePermission('imports:view')
  async importErrors(@CurrentUser() u: Principal, @Param('jobId', uuid()) id: string, @Query(new ZodPipe(importErrorsQuerySchema)) q: z.infer<typeof importErrorsQuerySchema>, @Res() res: Response) {
    if (q.format === 'csv') {
      // raw (non-enveloped) download: the interceptor ignores handlers that write the response themselves
      const csv = await this.imports.errorsCsv(u, id);
      res.status(200).type('text/csv').setHeader('content-disposition', `attachment; filename="import-${id}-errors.csv"`);
      res.send(csv);
      return;
    }
    const r = await this.imports.errors(u, id, q);
    res.status(200).json({ data: r.data, meta: { ...r.meta, requestId: (res.req as { id?: string }).id }, error: null });
  }

  @Limited('IMPORT')
  @Post('import/:jobId/retry')
  @HttpCode(200)
  @RequirePermission('imports:manage')
  importRetry(@CurrentUser() u: Principal, @Param('jobId', uuid()) id: string) {
    return this.imports.retry(u, id);
  }

  // ---- saved views ----------------------------------------------------------------------------------------------
  @Get('views')
  @RequirePermission('leads:view')
  views(@CurrentUser() u: Principal) {
    return this.leads.listViews(u);
  }

  @Post('views')
  @RequirePermission('leads:view')
  saveView(@CurrentUser() u: Principal, @Body(new ZodPipe(savedViewSchema)) b: z.infer<typeof savedViewSchema>) {
    return this.leads.saveView(u, b);
  }

  @Delete('views/:id')
  @HttpCode(200)
  @RequirePermission('leads:view')
  deleteView(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.leads.deleteView(u, id);
  }
}

@ApiTags('crm: leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly calls: CallsService,
    private readonly tasks: TasksService,
    private readonly events: EventsService,
  ) {}

  @Get(':id')
  @RequirePermission('leads:view')
  get(@CurrentUser() u: Principal, @Param('id', uuid()) id: string) {
    return this.leads.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('leads:update')
  update(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateLeadSchema)) b: z.infer<typeof updateLeadSchema>) {
    return this.leads.update(u, id, b);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('leads:assign')
  assign(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(assignLeadSchema)) b: z.infer<typeof assignLeadSchema>) {
    return this.leads.assign(u, id, b);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('leads:status:change')
  status(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(changeStatusSchema)) b: z.infer<typeof changeStatusSchema>) {
    return this.leads.changeStatus(u, id, b);
  }

  @Get(':id/timeline')
  @RequirePermission('leads:timeline:view')
  timeline(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Query(new ZodPipe(timelineQuerySchema)) q: z.infer<typeof timelineQuerySchema>) {
    return this.leads.timeline(u, id, q);
  }

  @Get(':id/calls')
  @RequirePermission('calls:view')
  listCalls(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Query(new ZodPipe(paginationQuerySchema)) q: { limit?: number; cursor?: string; page?: number }) {
    return this.calls.list(u, id, q);
  }

  @Post(':id/calls')
  @RequirePermission('calls:create')
  logCall(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(logCallSchema)) b: z.infer<typeof logCallSchema>, @Headers('idempotency-key') key?: string) {
    return this.calls.log(u, id, b, key);
  }

  @Post(':id/notes')
  @RequirePermission('leads:notes:create')
  addNote(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(createNoteSchema)) b: z.infer<typeof createNoteSchema>) {
    return this.leads.addNote(u, id, b);
  }

  @Post(':id/tasks')
  @RequirePermission('tasks:create')
  createTask(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(createTaskSchema)) b: z.infer<typeof createTaskSchema>, @Headers('idempotency-key') key?: string) {
    return this.tasks.create(u, b, id, key);
  }

  /** Executive/manager path to register a lead on a webinar/demo (participation state machine). */
  @Post(':id/events')
  @HttpCode(200)
  @RequirePermission('leads:status:change', 'events:view')
  linkEvent(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(eventLinkSchema)) b: z.infer<typeof eventLinkSchema>) {
    const { eventId, ...rest } = b;
    return this.events.setAttendance(u, eventId, { ...rest, leadId: id }, 'leads:status:change');
  }
}

export { bulkAssignSchema };
