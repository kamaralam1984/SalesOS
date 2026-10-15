import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NOTIFICATION_CATALOGUE } from '@salesos/platform-core';
import {
  notificationListQuerySchema, notificationPreferencesSchema, notificationRulesPatchSchema,
  type NotificationListQuery, type NotificationPreferencesInput, type NotificationRulesPatch,
} from '@salesos/validation';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ok } from '../../common/http/api-result';
import { ZodPipe } from '../../common/http/zod.pipe';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly svc: NotificationService,
    private readonly stream: NotificationStreamService,
    private readonly audit: AuditService,
  ) {}

  /** Own notifications only (scope: own). `?since=` is the polling fallback for the SSE stream. */
  @Get()
  @RequirePermission('notifications:view')
  async list(@CurrentUser() user: Principal, @Query(new ZodPipe(notificationListQuerySchema)) q: NotificationListQuery) {
    const r = await this.svc.list(user.userId, user.organizationId, q);
    return ok(r.data, r.meta);
  }

  /** Server-sent events scoped to the caller. Same payload shape as GET /notifications items. */
  @Get('stream')
  @RequirePermission('notifications:view')
  async sse(@CurrentUser() user: Principal, @Req() req: Request, @Res() res: Response) {
    await this.stream.open(user, req, res);
  }

  @Get('unread-count')
  @RequirePermission('notifications:view')
  async unread(@CurrentUser() user: Principal) {
    return { unreadCount: await this.svc.unreadCount(user.userId, user.organizationId) };
  }

  /** Type catalogue (labels, severity, mandatory flag) for the preferences UI. */
  @Get('types')
  @RequirePermission('notifications:view')
  types() {
    return Object.values(NOTIFICATION_CATALOGUE).map((t) => ({ key: t.key, label: t.label, category: t.category, severity: t.severity, mandatory: t.mandatory === true, defaultChannels: t.defaultChannels }));
  }

  @Post('read-all')
  @RequirePermission('notifications:view')
  readAll(@CurrentUser() user: Principal) {
    return this.svc.markAllRead(user.userId, user.organizationId);
  }

  @Get('preferences')
  @RequirePermission('notifications:manage-prefs')
  getPrefs(@CurrentUser() user: Principal) {
    return this.svc.getPreferences(user.userId, user.organizationId);
  }

  @Put('preferences')
  @RequirePermission('notifications:manage-prefs')
  putPrefs(@CurrentUser() user: Principal, @Body(new ZodPipe(notificationPreferencesSchema)) body: NotificationPreferencesInput) {
    return this.svc.putPreferences(user.userId, user.organizationId, body);
  }

  @Get('rules')
  @RequirePermission('notifications:config')
  getRules(@CurrentUser() user: Principal) {
    return this.svc.getRules(user.organizationId);
  }

  @Patch('rules')
  @RequirePermission('notifications:config')
  async patchRules(@CurrentUser() user: Principal, @Body(new ZodPipe(notificationRulesPatchSchema)) body: NotificationRulesPatch) {
    const out = await this.svc.patchRules(user.organizationId, body);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'notification.rules_changed', entityType: 'notification_rules', metadata: { types: (body.rules ?? []).map((r) => r.type), orgConfigChanged: !!body.orgConfig } });
    return out;
  }

  @Post(':id/read')
  @RequirePermission('notifications:view')
  read(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user.userId, user.organizationId, id);
  }

  @Post(':id/dismiss')
  @RequirePermission('notifications:view')
  dismiss(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.dismiss(user.userId, user.organizationId, id);
  }
}
