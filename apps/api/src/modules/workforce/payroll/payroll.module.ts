import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunsService } from './runs.service';
import { PayrollStructuresService } from './structures.service';

/** Payroll register (area C, DEC-048): salary structures, monthly runs, payslips, audited CSV export. No statutory calculation. */
@Module({ controllers: [PayrollController], providers: [PayrollStructuresService, PayrollRunsService] })
export class PayrollModule {}
