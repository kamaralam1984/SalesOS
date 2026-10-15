import { Limited } from '../../common/security/rate-limits';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { fileAttachSchema, fileListQuerySchema, filesSettingsPatchSchema } from '@salesos/validation';
import { DEFAULT_FILES_SETTINGS, type FilesSettings } from '@salesos/platform-core';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AccessService, CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ok } from '../../common/http/api-result';
import { AppError } from '../../common/http/errors';
import { ZodPipe } from '../../common/http/zod.pipe';
import { FilesService } from './files.service';
import { readUpload } from './multipart';
import { maxBytesFor, parseUploadName, FileRejected } from '@salesos/platform-core';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly svc: FilesService,
    private readonly access: AccessService,
  ) {}

  /** Multipart upload (field `file`; optional text fields entityType, entityId, purpose). Returns 201-style envelope with status PENDING. */
  @Limited('UPLOAD')
  @Post()
  @RequirePermission('files:upload')
  async upload(@CurrentUser() user: Principal, @Req() req: Request) {
    const settings = await this.svc.settings(user.organizationId);
    const hardMax = Math.max(...Object.values(settings.maxBytesByCategory));
    const up = await readUpload(req, {
      hardMax,
      maxBytesFor: (filename) => {
        try {
          return maxBytesFor(parseUploadName(filename).category, settings);
        } catch (e) {
          if (e instanceof FileRejected) throw new AppError(e.code, e.message, 422);
          throw e;
        }
      },
    });
    return this.svc.upload(user, {
      filename: up.file.filename, declaredType: up.file.mimeType, data: up.file.data,
      entityType: up.fields.entityType || undefined, entityId: up.fields.entityId || undefined, purpose: up.fields.purpose || undefined,
    });
  }

  @Get('settings')
  @RequirePermission('integrations:manage')
  async getSettings(@CurrentUser() user: Principal): Promise<{ settings: FilesSettings; defaults: FilesSettings; allowed: ReturnType<FilesService['allowedExtensions']>; scanner: string; pdfOptimiser: string }> {
    return {
      settings: await this.svc.settings(user.organizationId), defaults: DEFAULT_FILES_SETTINGS, allowed: this.svc.allowedExtensions(),
      scanner: process.env.FILE_SCANNER ?? (process.env.CLAMAV_HOST ? 'clamd' : 'local-eicar (not an antivirus engine)'),
      pdfOptimiser: 'qpdf or ghostscript when installed on the worker host; otherwise PDFs are stored as uploaded',
    };
  }

  @Patch('settings')
  @RequirePermission('integrations:manage')
  patchSettings(@CurrentUser() user: Principal, @Body(new ZodPipe(filesSettingsPatchSchema)) body: z.infer<typeof filesSettingsPatchSchema>) {
    return this.svc.patchSettings(user, body as Partial<FilesSettings>);
  }

  @Get()
  @RequirePermission('files:view')
  async list(@CurrentUser() user: Principal, @Query(new ZodPipe(fileListQuerySchema)) q: z.infer<typeof fileListQuerySchema>) {
    const r = await this.svc.list(user, q);
    return ok(r.data, r.meta);
  }

  @Get(':id')
  @RequirePermission('files:view')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Limited('DOWNLOAD')
  @Get(':id/download-url')
  @RequirePermission('files:view')
  downloadUrl(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Query('variant') variant?: string) {
    return this.svc.signedDownload(user, id, variant);
  }

  /** Authenticated streaming download (same checks as the signed URL). */
  @Limited('DOWNLOAD')
  @Get(':id/download')
  @RequirePermission('files:view')
  async download(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @Query('variant') variant?: string) {
    const d = await this.svc.streamDownload(user, id, variant);
    res.status(200).set({
      'Content-Type': d.contentType, 'Content-Length': String(d.data.length),
      'Content-Disposition': `attachment; filename="${d.filename.replace(/[^\w. ()\-+]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    });
    res.end(d.data);
  }

  @Post(':id/attach')
  @RequirePermission('files:upload')
  attach(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fileAttachSchema)) body: z.infer<typeof fileAttachSchema>) {
    return this.svc.attach(user, id, body.entityType, body.entityId);
  }

  @Post(':id/retry')
  @RequirePermission('files:delete')
  retry(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(user, id);
  }

  @Delete(':id')
  @RequirePermission('files:delete')
  remove(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }
}
