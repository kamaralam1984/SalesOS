import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getFlag } from '@salesos/platform-core';
import { CurrentUser, RequirePermission, type Principal } from '../../common/authz';
import { AppError } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';

/**
 * Call recordings are BLOCKED (DEC-014, BP-AND-008) until a separate technical, consent, privacy and legal review.
 * Only the schema (recording_assets) exists. These guarded endpoints answer 403 RECORDINGS_DISABLED while the
 * `recordings.enabled` flag is off; no API in this codebase can switch the flag on.
 */
@ApiTags('recordings')
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly prisma: PrismaService) {}

  private async guard(user: Principal): Promise<never> {
    await getFlag(this.prisma, user.organizationId, 'recordings.enabled'); // read for audit/trace parity; value never enables anything yet
    throw new AppError('RECORDINGS_DISABLED', 'Call recording is blocked pending consent, privacy and legal review (DEC-014)', 403);
  }

  @Get()
  @RequirePermission('integrations:manage')
  list(@CurrentUser() user: Principal) {
    return this.guard(user);
  }

  @Post()
  @RequirePermission('integrations:manage')
  create(@CurrentUser() user: Principal) {
    return this.guard(user);
  }
}
