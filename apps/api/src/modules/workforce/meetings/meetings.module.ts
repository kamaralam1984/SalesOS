import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

/** Extra Zoom meetings announced on everyone's home page by HR, the Founder or the Developer. */
@Module({ controllers: [MeetingsController], providers: [MeetingsService] })
export class MeetingsModule {}
