import { Injectable } from '@nestjs/common';
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from '@salesos/validation';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../../../common/prisma';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings(organizationId: string, client: Pick<Tx, 'organization'> = this.prisma): Promise<OrgSettings> {
    const org = await client.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return { ...DEFAULT_ORG_SETTINGS, ...(org.settings as Partial<OrgSettings>) };
  }

  async getOrg(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return { id: org.id, name: org.name, slug: org.slug, settings: { ...DEFAULT_ORG_SETTINGS, ...(org.settings as object) } };
  }

  async update(actor: Principal, patch: Partial<OrgSettings>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getSettings(actor.organizationId, tx);
      const after = { ...before, ...patch };
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: { settings: after as unknown as Prisma.InputJsonValue },
      });
      await this.audit.recordTx(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.POLICY_CHANGED,
        entityType: 'organization',
        entityId: actor.organizationId,
        metadata: { before, after, changedKeys: Object.keys(patch) },
      });
      return after;
    });
  }
}
