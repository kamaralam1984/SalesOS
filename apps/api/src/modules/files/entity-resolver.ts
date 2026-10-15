import type { AccessService, PermissionKey, Principal } from '../../common/authz';
import type { FileAccessRegistry, FileEntityResolver } from './file-access.registry';

export interface FileRecordRef {
  organizationId: string;
  ownerId: string | null;
  teamId?: string | null;
  /** Additional users who legitimately act on the record (e.g. the reviewer of a review). They still need the view permission. */
  alsoUserIds?: string[];
  /** Record is in a restricted state (e.g. an unpublished SOP draft): the user must additionally hold one of these permissions. */
  requireAnyOf?: PermissionKey[];
}

export interface RecordFileResolverOptions {
  /** Load only the scope columns of the record; return null when it does not exist. MUST NOT filter by organization (the check does). */
  load: (id: string, user: Principal) => Promise<FileRecordRef | null>;
  /** Permission needed to read files attached to the record. */
  view: PermissionKey;
  /** Any of these permissions (record-scoped) allows attaching files. Empty = attaching is not allowed for this type. */
  attach: PermissionKey[];
  /** Summary-only holders (minimum-data roles) may see the record's metadata but never its documents. Default false. */
  allowSummary?: boolean;
}

/**
 * Scope inheritance for attached files: a file is as visible as the entity it is attached to, evaluated with the SAME
 * permission + scope rules as the entity itself (org / team hierarchy / own / summary). Missing, cross-org or
 * out-of-scope records and summary-only holders fail closed.
 */
export function recordFileResolver(access: AccessService, o: RecordFileResolverOptions): FileEntityResolver {
  return async ({ user, entityId, mode }) => {
    const permissions = mode === 'read' ? [o.view] : o.attach;
    if (!/^[0-9a-f-]{36}$/i.test(entityId)) return false;
    const ref = await o.load(entityId, user);
    if (!ref || ref.organizationId !== user.organizationId) return false;
    if (ref.requireAnyOf && !ref.requireAnyOf.some((k) => access.has(user, k))) return false;
    for (const permission of permissions) {
      if (!access.has(user, permission)) continue;
      if (!o.allowSummary && access.isSummaryOnly(user, permission)) continue;
      if (await access.canAccessRecord(user, permission, ref)) return true;
      if (ref.alsoUserIds?.includes(user.userId)) return true;
    }
    return false;
  };
}

/** Registers one resolver per entity type (convenience for a module's onModuleInit). */
export function registerRecordFileResolvers(registry: FileAccessRegistry, access: AccessService, defs: Record<string, RecordFileResolverOptions>): void {
  for (const [type, o] of Object.entries(defs)) registry.register(type, recordFileResolver(access, o));
}
