import { Module } from '@nestjs/common';
import { PeopleModule } from '../../people/people.module';
import { BirthdaysService } from './birthdays.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { ProbationService } from './probation.service';

/** Workforce / HR automation (DEC-048 area D2): HR profile fields, birthdays, probation decisions. HR data stays behind hr:records:* and onboarding:manage. */
@Module({
  imports: [PeopleModule],
  controllers: [HrController],
  providers: [HrService, BirthdaysService, ProbationService],
  exports: [ProbationService, BirthdaysService],
})
export class HrModule {}
