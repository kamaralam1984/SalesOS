import { Module } from '@nestjs/common';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';

/** Holiday calendar (area A, DEC-048): HR-managed, suggestions never count until approved, every change audited with before/after. */
@Module({ controllers: [HolidaysController], providers: [HolidaysService] })
export class HolidaysModule {}
