import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  createCampaignSchema, createLostReasonSchema, createProgramSchema, createSourceSchema, createStageSchema, updateAutomationRuleSchema, updateLostReasonSchema, updateProgramSchema, updateSourceSchema,
  updateStageSchema, upsertAssignmentRuleSchema, upsertAutomationRuleSchema,
} from '@salesos/validation';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { ConfigService } from './config.service';

const uuid = () => new ParseUUIDPipe();

@ApiTags('crm: configuration')
@Controller()
export class ConfigController {
  constructor(private readonly cfg: ConfigService) {}

  @Get('lead-sources')
  @RequirePermission('sources:view')
  sources(@CurrentUser() u: Principal) {
    return this.cfg.listSources(u);
  }
  @Post('lead-sources')
  @RequirePermission('sources:manage')
  createSource(@CurrentUser() u: Principal, @Body(new ZodPipe(createSourceSchema)) b: z.infer<typeof createSourceSchema>) {
    return this.cfg.createSource(u, b);
  }
  @Patch('lead-sources/:id')
  @RequirePermission('sources:manage')
  updateSource(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateSourceSchema)) b: z.infer<typeof updateSourceSchema>) {
    return this.cfg.updateSource(u, id, b);
  }
  @Get('campaigns')
  @RequirePermission('sources:view')
  campaigns(@CurrentUser() u: Principal) {
    return this.cfg.listCampaigns(u);
  }
  @Post('campaigns')
  @RequirePermission('sources:manage')
  createCampaign(@CurrentUser() u: Principal, @Body(new ZodPipe(createCampaignSchema)) b: z.infer<typeof createCampaignSchema>) {
    return this.cfg.createCampaign(u, b);
  }

  @Get('programs')
  @RequirePermission('programs:view')
  programs(@CurrentUser() u: Principal) {
    return this.cfg.listPrograms(u);
  }
  @Post('programs')
  @RequirePermission('programs:manage')
  createProgram(@CurrentUser() u: Principal, @Body(new ZodPipe(createProgramSchema)) b: z.infer<typeof createProgramSchema>) {
    return this.cfg.createProgram(u, b);
  }
  @Patch('programs/:id')
  @RequirePermission('programs:manage')
  updateProgram(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateProgramSchema)) b: z.infer<typeof updateProgramSchema>) {
    return this.cfg.updateProgram(u, id, b);
  }

  @Get('lead-stages')
  @RequirePermission('settings:view')
  stages(@CurrentUser() u: Principal) {
    return this.cfg.listStages(u);
  }
  @Post('lead-stages')
  @RequirePermission('settings:update')
  createStage(@CurrentUser() u: Principal, @Body(new ZodPipe(createStageSchema)) b: z.infer<typeof createStageSchema>) {
    return this.cfg.createStage(u, b);
  }
  @Patch('lead-stages/:id')
  @RequirePermission('settings:update')
  updateStage(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateStageSchema)) b: z.infer<typeof updateStageSchema>) {
    return this.cfg.updateStage(u, id, b);
  }

  @Get('lost-reasons')
  @RequirePermission('settings:view')
  lostReasons(@CurrentUser() u: Principal) {
    return this.cfg.listLostReasons(u);
  }
  @Post('lost-reasons')
  @RequirePermission('settings:update')
  createLostReason(@CurrentUser() u: Principal, @Body(new ZodPipe(createLostReasonSchema)) b: z.infer<typeof createLostReasonSchema>) {
    return this.cfg.createLostReason(u, b);
  }
  @Patch('lost-reasons/:id')
  @RequirePermission('settings:update')
  updateLostReason(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateLostReasonSchema)) b: z.infer<typeof updateLostReasonSchema>) {
    return this.cfg.updateLostReason(u, id, b);
  }

  @Get('automation-rules')
  @RequirePermission('settings:view')
  rules(@CurrentUser() u: Principal) {
    return this.cfg.listRules(u);
  }
  @Post('automation-rules')
  @RequirePermission('settings:update')
  upsertRule(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertAutomationRuleSchema)) b: z.infer<typeof upsertAutomationRuleSchema>) {
    return this.cfg.upsertRule(u, b);
  }
  @Patch('automation-rules/:id')
  @RequirePermission('settings:update')
  updateRule(@CurrentUser() u: Principal, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateAutomationRuleSchema)) b: z.infer<typeof updateAutomationRuleSchema>) {
    return this.cfg.updateRule(u, id, b);
  }

  @Get('assignment-rules')
  @RequirePermission('settings:view')
  assignmentRules(@CurrentUser() u: Principal) {
    return this.cfg.listAssignmentRules(u);
  }
  @Put('assignment-rules')
  @RequirePermission('settings:update')
  upsertAssignmentRule(@CurrentUser() u: Principal, @Body(new ZodPipe(upsertAssignmentRuleSchema)) b: z.infer<typeof upsertAssignmentRuleSchema>) {
    return this.cfg.upsertAssignmentRule(u, b);
  }
}
