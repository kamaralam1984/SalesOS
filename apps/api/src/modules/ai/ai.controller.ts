import { Limited } from '../../common/security/rate-limits';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { aiConfigPatchSchema, aiDraftInputSchema, aiSuggestionReviewSchema, aiTextInputSchema, aiUsageQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly svc: AiService) {}

  @Get('status')
  @RequirePermission('ai:use')
  status(@CurrentUser() user: Principal) {
    return this.svc.status(user);
  }

  @Get('config')
  @RequirePermission('ai:config')
  config(@CurrentUser() user: Principal) {
    return this.svc.config(user.organizationId);
  }

  @Patch('config')
  @RequirePermission('ai:config')
  patchConfig(@CurrentUser() user: Principal, @Body(new ZodPipe(aiConfigPatchSchema)) body: z.infer<typeof aiConfigPatchSchema>) {
    return this.svc.patchConfig(user, body);
  }

  @Get('usage')
  @RequirePermission('ai:usage:view')
  usage(@CurrentUser() user: Principal, @Query(new ZodPipe(aiUsageQuerySchema)) q: z.infer<typeof aiUsageQuerySchema>) {
    return this.svc.usage(user, q.days);
  }

  @Limited('AI')
  @Post('summarize')
  @RequirePermission('ai:use')
  summarize(@CurrentUser() user: Principal, @Body(new ZodPipe(aiTextInputSchema)) body: z.infer<typeof aiTextInputSchema>) {
    return this.svc.run(user, 'summarize', body);
  }

  @Limited('AI')
  @Post('extract')
  @RequirePermission('ai:use')
  extract(@CurrentUser() user: Principal, @Body(new ZodPipe(aiTextInputSchema)) body: z.infer<typeof aiTextInputSchema>) {
    return this.svc.run(user, 'extract', body);
  }

  @Limited('AI')
  @Post('draft-followup')
  @RequirePermission('ai:use')
  draft(@CurrentUser() user: Principal, @Body(new ZodPipe(aiDraftInputSchema)) body: z.infer<typeof aiDraftInputSchema>) {
    return this.svc.run(user, 'draft_followup', body);
  }

  @Limited('AI')
  @Get('call-brief/:leadId')
  @RequirePermission('ai:use')
  callBrief(@CurrentUser() user: Principal, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.svc.callBrief(user, leadId);
  }

  @Get('lead-priority')
  @RequirePermission('ai:use')
  leadPriority(@CurrentUser() user: Principal, @Query('limit') limit?: string) {
    return this.svc.leadPriority(user, Math.min(100, Math.max(1, Number(limit) || 25)));
  }

  @Get('suggestions')
  @RequirePermission('ai:use')
  suggestions(@CurrentUser() user: Principal) {
    return this.svc.listSuggestions(user);
  }

  @Get('suggestions/:id')
  @RequirePermission('ai:use')
  suggestion(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSuggestion(user, id);
  }

  @Patch('suggestions/:id')
  @RequirePermission('ai:use')
  review(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(aiSuggestionReviewSchema)) body: z.infer<typeof aiSuggestionReviewSchema>) {
    return this.svc.review(user, id, body.action, body.editedOutput);
  }
}
