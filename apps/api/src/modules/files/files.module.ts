import { Global, Logger, Module, OnModuleInit, Inject } from '@nestjs/common';
import type { ObjectStorage } from '@salesos/platform-core';
import { AccessService } from '../../common/authz';
import { FileAccessRegistry } from './file-access.registry';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { RecordingsController } from './recordings.controller';
import { STORAGE, storageProvider } from './storage.provider';

/**
 * Files domain (Agent F). Global exports: `FilesService`, `FileAccessRegistry` (domains register entity resolvers so
 * attached files inherit the entity's access scope - docs/platform-report.md section 1.2).
 */
@Global()
@Module({
  controllers: [FilesController, RecordingsController],
  providers: [storageProvider, FileAccessRegistry, FilesService],
  exports: [FilesService, FileAccessRegistry, STORAGE],
})
export class FilesModule implements OnModuleInit {
  private readonly log = new Logger('FilesModule');
  constructor(
    private readonly registry: FileAccessRegistry,
    private readonly access: AccessService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit() {
    // built-in resolver: files attached to a user profile (e.g. avatars, HR docs are NOT allowed here) follow users:view scope
    this.registry.register('user', async ({ user, entityId, mode }) => {
      if (mode === 'attach') return entityId === user.userId;
      return entityId === user.userId || (await this.access.canAccessRecord(user, 'users:view', { organizationId: user.organizationId, ownerId: entityId }));
    });
    try {
      await this.storage.ensureBucket();
    } catch (e) {
      this.log.warn(`object storage unavailable at boot (${(e as Error).message}); uploads will fail until it is reachable`);
    }
  }
}
