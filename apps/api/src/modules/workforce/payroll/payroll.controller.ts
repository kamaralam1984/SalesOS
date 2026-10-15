import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addAdjustmentSchema,
  approvePayrollRunSchema,
  cancelPayrollRunSchema,
  createPayrollRunSchema,
  createSalaryStructureSchema,
  exportPayrollRunQuerySchema,
  listPayrollRunsQuerySchema,
  listPayslipsQuerySchema,
  listStructuresQuerySchema,
  markPayrollPaidSchema,
  sendBackPayrollRunSchema,
} from '@salesos/validation';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type Principal } from '../../../common/authz';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { PayrollRunsService } from './runs.service';
import { PayrollStructuresService } from './structures.service';

/** Payroll register (DEC-048): no statutory calculation, SalesOS never moves money. Admin holds none of these keys (DEC-032). */
@ApiTags('workforce/payroll')
@Controller('workforce/payroll')
export class PayrollController {
  constructor(private readonly structures: PayrollStructuresService, private readonly runs: PayrollRunsService) {}

  // ---- structures --------------------------------------------------------------------------------------------------
  @Get('structures')
  @RequirePermission('payroll:structure:view')
  listStructures(@CurrentUser() u: Principal, @Query(new ZodPipe(listStructuresQuerySchema)) q: z.infer<typeof listStructuresQuerySchema>) {
    return this.structures.listCurrent(u, q);
  }

  @Get('structures/:userId')
  @RequirePermission('payroll:structure:view')
  structureHistory(@CurrentUser() u: Principal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.structures.history(u, userId);
  }

  @Post('structures')
  @RequirePermission('payroll:structure:manage')
  createStructure(@CurrentUser() u: Principal, @Body(new ZodPipe(createSalaryStructureSchema)) b: z.infer<typeof createSalaryStructureSchema>) {
    return this.structures.create(u, b);
  }

  // ---- runs --------------------------------------------------------------------------------------------------------
  @Post('runs')
  @RequirePermission('payroll:run:manage')
  createRun(@CurrentUser() u: Principal, @Body(new ZodPipe(createPayrollRunSchema)) b: z.infer<typeof createPayrollRunSchema>) {
    return this.runs.create(u, b);
  }

  @Get('runs')
  @RequirePermission('payroll:run:view')
  listRuns(@CurrentUser() u: Principal, @Query(new ZodPipe(listPayrollRunsQuerySchema)) q: z.infer<typeof listPayrollRunsQuerySchema>) {
    return this.runs.list(u, q);
  }

  @Get('runs/:id')
  @RequirePermission('payroll:run:view')
  getRun(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(u, id);
  }

  @Post('runs/:id/calculate')
  @HttpCode(200)
  @RequirePermission('payroll:run:manage')
  calculate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.calculate(u, id);
  }

  @Post('runs/:id/payslips/:slipId/adjustments')
  @RequirePermission('payroll:run:manage')
  addAdjustment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('slipId', ParseUUIDPipe) slipId: string, @Body(new ZodPipe(addAdjustmentSchema)) b: z.infer<typeof addAdjustmentSchema>) {
    return this.runs.addAdjustment(u, id, slipId, b);
  }

  @Delete('runs/:id/payslips/:slipId/adjustments/:adjustmentId')
  @RequirePermission('payroll:run:manage')
  removeAdjustment(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('slipId', ParseUUIDPipe) slipId: string, @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string) {
    return this.runs.removeAdjustment(u, id, slipId, adjustmentId);
  }

  @Post('runs/:id/approve')
  @HttpCode(200)
  @RequirePermission('payroll:run:approve')
  approve(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(approvePayrollRunSchema)) _b: z.infer<typeof approvePayrollRunSchema>) {
    return this.runs.approve(u, id);
  }

  @Post('runs/:id/send-back')
  @HttpCode(200)
  @RequirePermission('payroll:run:approve')
  sendBack(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sendBackPayrollRunSchema)) b: z.infer<typeof sendBackPayrollRunSchema>) {
    return this.runs.sendBack(u, id, b);
  }

  @Post('runs/:id/mark-paid')
  @HttpCode(200)
  @RequirePermission('payroll:run:mark-paid')
  markPaid(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(markPayrollPaidSchema)) b: z.infer<typeof markPayrollPaidSchema>) {
    return this.runs.markPaid(u, id, b);
  }

  @Post('runs/:id/cancel')
  @HttpCode(200)
  @RequirePermission('payroll:run:manage')
  cancel(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelPayrollRunSchema)) b: z.infer<typeof cancelPayrollRunSchema>) {
    return this.runs.cancel(u, id, b);
  }

  @Get('runs/:id/export')
  @RequirePermission('payroll:run:view')
  async export(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(exportPayrollRunQuerySchema)) _q: z.infer<typeof exportPayrollRunQuerySchema>, @Res() res: Response) {
    const f = await this.runs.exportCsv(u, id);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${f.fileName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(f.body);
  }

  // ---- payslips ----------------------------------------------------------------------------------------------------
  @Get('payslips/mine')
  @RequirePermission('payroll:payslip:view')
  mine(@CurrentUser() u: Principal, @Query(new ZodPipe(listPayslipsQuerySchema)) q: z.infer<typeof listPayslipsQuerySchema>) {
    return this.runs.mine(u, q);
  }

  @Get('payslips/:id')
  @RequirePermission('payroll:payslip:view')
  payslip(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.getPayslip(u, id);
  }
}
