import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { workforceReportExportQuerySchema, workforceReportKeySchema, workforceReportQuerySchema, type WorkforceReportKey } from '@salesos/validation';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Limited } from '../../../common/security/rate-limits';
import { WorkforceExportService } from './export.service';
import { WorkforceReportsService } from './reports.service';

@ApiTags('workforce-reports')
@Controller('workforce/reports')
export class WorkforceReportsController {
  constructor(private readonly reports: WorkforceReportsService, private readonly exporter: WorkforceExportService) {}

  /** Report rows + summary, limited to the viewer's workforce:reports:view scope. Birthdays additionally need birthdays:view. */
  @Limited('REPORT')
  @Get(':report')
  @RequirePermission('workforce:reports:view')
  run(@CurrentUser() u: Principal, @Param('report', new ZodPipe(workforceReportKeySchema)) report: WorkforceReportKey, @Query(new ZodPipe(workforceReportQuerySchema)) q: z.infer<typeof workforceReportQuerySchema>) {
    return this.reports.page(u, report, q);
  }

  @Limited('EXPORT')
  @Get(':report/export')
  @RequirePermission('workforce:reports:export')
  async export(@CurrentUser() u: Principal, @Param('report', new ZodPipe(workforceReportKeySchema)) report: WorkforceReportKey, @Query(new ZodPipe(workforceReportExportQuerySchema)) q: z.infer<typeof workforceReportExportQuerySchema>, @Res() res: Response) {
    const f = await this.exporter.export(u, report, q);
    res.status(200).set({
      'Content-Type': f.contentType,
      'Content-Length': String(f.data.length),
      'Content-Disposition': `attachment; filename="${f.fileName.replace(/[^\w. ()\-+]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'X-Row-Count': String(f.rowCount),
      'X-Truncated': String(f.truncated),
    });
    res.end(f.data);
  }
}
