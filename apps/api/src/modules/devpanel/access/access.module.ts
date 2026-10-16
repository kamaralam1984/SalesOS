import { Module } from '@nestjs/common';
import { PermissionResolver } from '../../../common/authz/principal.loader';
import { DevAccessController } from './access.controller';
import { DevAccessService } from './access.service';

/** Developer Panel / access. Owned by one agent: add controllers/providers here and only in this folder. */
@Module({ controllers: [DevAccessController], providers: [DevAccessService, PermissionResolver] })
export class DevAccessModule {}
