import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createEscalationSchema, createRelationshipNoteSchema, escalationTransitionSchema, listEscalationsQuerySchema, listWatchlistQuerySchema, setLearnerEarningsSchema, watchProspectSchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { EscalationsService } from './escalations.service';
import { RelationshipsService } from './relationships.service';

@ApiTags('cx-relationships')
@Controller('cx')
export class RelationshipsController {
  constructor(private readonly rel: RelationshipsService, private readonly esc: EscalationsService) {}

  // NOTE: static segments are declared before `:leadId` so they are not captured by the parameter route.
  @Get('relationships/watchlist')
  @RequirePermission('relationships:view')
  watchlist(@CurrentUser() u: Principal, @Query(new ZodPipe(listWatchlistQuerySchema)) q: z.infer<typeof listWatchlistQuerySchema>) {
    return this.rel.watchlist(u, q);
  }

  @Post('relationships/watchlist')
  @RequirePermission('relationships:update')
  watch(@CurrentUser() u: Principal, @Body(new ZodPipe(watchProspectSchema)) b: z.infer<typeof watchProspectSchema>) {
    return this.rel.watch(u, b);
  }

  @Delete('relationships/watchlist/:leadId')
  @RequirePermission('relationships:update')
  unwatch(@CurrentUser() u: Principal, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.rel.unwatch(u, leadId);
  }

  @Get('relationships/:leadId')
  @RequirePermission('relationships:view')
  history(@CurrentUser() u: Principal, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.rel.history(u, leadId);
  }

  @Post('relationships/:leadId/learner-earnings')
  @RequirePermission('relationships:update')
  setEarnings(@CurrentUser() u: Principal, @Param('leadId', ParseUUIDPipe) leadId: string, @Body(new ZodPipe(setLearnerEarningsSchema)) b: z.infer<typeof setLearnerEarningsSchema>) {
    return this.rel.setLearnerEarnings(u, leadId, b);
  }

  @Post('relationships/:leadId/notes')
  @RequirePermission('relationships:update')
  addNote(@CurrentUser() u: Principal, @Param('leadId', ParseUUIDPipe) leadId: string, @Body(new ZodPipe(createRelationshipNoteSchema)) b: z.infer<typeof createRelationshipNoteSchema>) {
    return this.rel.addNote(u, leadId, b);
  }

  @Get('escalations')
  @RequirePermission('complaints:view')
  listEscalations(@CurrentUser() u: Principal, @Query(new ZodPipe(listEscalationsQuerySchema)) q: z.infer<typeof listEscalationsQuerySchema>) {
    return this.esc.list(u, q);
  }

  @Post('escalations')
  @RequirePermission('complaints:create')
  createEscalation(@CurrentUser() u: Principal, @Body(new ZodPipe(createEscalationSchema)) b: z.infer<typeof createEscalationSchema>) {
    return this.esc.create(u, b);
  }

  @Get('escalations/:id')
  @RequirePermission('complaints:view')
  getEscalation(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.esc.detail(u, id);
  }

  @Post('escalations/:id/transition')
  @HttpCode(200)
  @RequirePermission('complaints:update')
  transitionEscalation(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(escalationTransitionSchema)) b: z.infer<typeof escalationTransitionSchema>) {
    return this.esc.transition(u, id, b);
  }
}
