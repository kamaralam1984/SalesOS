import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { FeaturesService } from './features.service';

const subject = z.object({ subjectType: z.enum(['ROLE', 'USER']), subject: z.string().trim().min(1).max(64) });
const viewQuery = subject;
const changeBody = subject.extend({
  changes: z
    .array(z.object({ permissionKey: z.string().min(3).max(120), state: z.enum(['DEFAULT', 'ON', 'OFF']), scope: z.enum(['summary', 'own', 'team', 'org']).optional() }))
    .min(1)
    .max(60),
  confirmSensitive: z.boolean().optional(),
});
const resetBody = subject;

/** Developer Panel / Feature access. DEVELOPER only: which screens and features each role or user has. */
@ApiTags('dev-panel')
@Controller('dev-panel/features')
export class FeaturesController {
  constructor(private readonly svc: FeaturesService) {}

  @Get('summary')
  @RequirePermission('devpanel:features:view')
  summary(@CurrentUser() u: Principal) {
    return this.svc.summary(u);
  }

  @Get()
  @RequirePermission('devpanel:features:view')
  view(@CurrentUser() u: Principal, @Query(new ZodPipe(viewQuery)) q: z.infer<typeof viewQuery>) {
    return this.svc.view(u, q.subjectType, q.subject);
  }

  @Put()
  @RequirePermission('devpanel:features:manage')
  change(@CurrentUser() u: Principal, @Body(new ZodPipe(changeBody)) b: z.infer<typeof changeBody>) {
    return this.svc.change(u, b.subjectType, b.subject, b.changes, b.confirmSensitive === true);
  }

  @Post('reset')
  @HttpCode(200)
  @RequirePermission('devpanel:features:manage')
  reset(@CurrentUser() u: Principal, @Body(new ZodPipe(resetBody)) b: z.infer<typeof resetBody>) {
    return this.svc.reset(u, b.subjectType, b.subject);
  }
}
