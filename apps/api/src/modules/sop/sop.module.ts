import { Module, type OnModuleInit } from '@nestjs/common';
import { AccessService } from '../../common/authz';
import { PrismaService } from '../../common/prisma';
import { FileAccessRegistry } from '../files/file-access.registry';
import { registerRecordFileResolvers } from '../files/entity-resolver';
import { SopController } from './sop.controller';
import { SopService } from './sop.service';
import { ensureSopGuards } from './sop-guards';
import { autoDdlEnabled } from '../../common/prisma/auto-ddl';

/** SOP / playbook centre (Phase 6): versioned documents, approval, acknowledgements, adoption, process-gap backlog. */
@Module({ controllers: [SopController], providers: [SopService], exports: [SopService] })
export class SopModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly files: FileAccessRegistry) {}
  async onModuleInit() {
    if (autoDdlEnabled()) await ensureSopGuards(this.prisma);
    // SOP attachments follow the version's visibility (sop:view is org-wide); attaching needs sop:create.
    registerRecordFileResolvers(this.files, this.access, {
      sop_version: {
        view: 'sop:view', attach: ['sop:create'],
        load: async (id) => {
          const v = await this.prisma.sopVersion.findUnique({ where: { id }, select: { organizationId: true, status: true, createdById: true, document: { select: { ownerId: true } } } });
          if (!v) return null;
          const published = ['APPROVED', 'SUPERSEDED', 'RETIRED'].includes(v.status);
          return { organizationId: v.organizationId, ownerId: v.document.ownerId, alsoUserIds: [v.createdById], ...(published ? {} : { requireAnyOf: ['sop:create' as const, 'sop:approve' as const] }) };
        },
      },
    });
  }
}
