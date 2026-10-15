import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { birthdaysQuerySchema, hrProfilePatchSchema, probationDecisionSchema, probationListQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { BirthdaysService } from './birthdays.service';
import { HrService } from './hr.service';
import { ProbationService } from './probation.service';

@ApiTags('workforce-hr')
@Controller('workforce')
export class HrController {
  constructor(private readonly hr: HrService, private readonly birthdays: BirthdaysService, private readonly probation: ProbationService) {}

  /** HR record (date of birth, probation, employee code...). HR only; every read is audited. */
  @Get('hr/profiles/:userId')
  @RequirePermission('hr:records:view')
  profile(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.hr.getProfile(u, userId);
  }

  @Patch('hr/profiles/:userId')
  @RequirePermission('hr:records:manage')
  patchProfile(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(hrProfilePatchSchema)) b: z.infer<typeof hrProfilePatchSchema>) {
    return this.hr.patchProfile(u, userId, b);
  }

  @Get('hr/birthdays')
  @RequirePermission('birthdays:view')
  hrBirthdays(@CurrentUser() u: Principal, @Query(new ZodPipe(birthdaysQuerySchema)) q: z.infer<typeof birthdaysQuerySchema>) {
    return this.birthdays.forHr(u, q.days, q.limit);
  }

  /** Team-visible: only people who chose to share, day + month only. */
  @Get('birthdays/upcoming')
  @RequirePermission('directory:view')
  sharedBirthdays(@CurrentUser() u: Principal, @Query(new ZodPipe(birthdaysQuerySchema)) q: z.infer<typeof birthdaysQuerySchema>) {
    return this.birthdays.shared(u, q.days, q.limit);
  }

  @Get('hr/probation')
  @RequirePermission('workforce:reports:view')
  probationList(@CurrentUser() u: Principal, @Query(new ZodPipe(probationListQuerySchema)) q: z.infer<typeof probationListQuerySchema>) {
    return this.probation.list(u, q);
  }

  @Get('hr/probation/:userId/history')
  @RequirePermission('onboarding:manage')
  probationHistory(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.probation.history(u, userId);
  }

  @Post('hr/probation/:userId/decision')
  @HttpCode(200)
  @RequirePermission('onboarding:manage')
  decide(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(probationDecisionSchema)) b: z.infer<typeof probationDecisionSchema>) {
    return this.probation.decide(u, userId, b);
  }
}
