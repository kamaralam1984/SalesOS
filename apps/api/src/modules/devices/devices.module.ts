import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

/** Companion devices: registry + approval + revoke (data model only; no Android code). Gated by the devices.enabled flag. */
@Module({ controllers: [DevicesController], providers: [DevicesService] })
export class DevicesModule {}
