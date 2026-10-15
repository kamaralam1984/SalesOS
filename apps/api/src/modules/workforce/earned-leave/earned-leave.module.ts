import { Module } from '@nestjs/common';
import { EarnedLeaveController } from './earned-leave.controller';
import { EarnedLeaveService } from './earned-leave.service';

/** Earned Leave (area A, DEC-048): progress, explained credits, manual run of the same engine the nightly worker uses. */
@Module({ controllers: [EarnedLeaveController], providers: [EarnedLeaveService] })
export class EarnedLeaveModule {}
