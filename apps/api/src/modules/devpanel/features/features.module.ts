import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';

/** Developer Panel / Feature access. PermissionResolver comes from the global AuthzModule so the override cache is shared. */
@Module({ controllers: [FeaturesController], providers: [FeaturesService] })
export class DevFeaturesModule {}
