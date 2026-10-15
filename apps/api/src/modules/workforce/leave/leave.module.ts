import { Module } from '@nestjs/common';
import { LeaveBalancesService } from './balances.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

/** Leave (area A, DEC-048): types, balances (append-only ledger), requests with the Manager -> HR approval chain, calendar. */
@Module({ controllers: [LeaveController], providers: [LeaveService, LeaveBalancesService] })
export class LeaveModule {}
