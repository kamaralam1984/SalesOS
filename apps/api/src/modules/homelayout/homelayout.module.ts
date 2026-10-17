import { Module } from '@nestjs/common';
import { HomeLayoutController } from './homelayout.controller';
import { HomeLayoutService } from './homelayout.service';

/** Per-role phone home layout (which widgets, their order and size), set by the Founder or the Developer. */
@Module({ controllers: [HomeLayoutController], providers: [HomeLayoutService] })
export class HomeLayoutModule {}
