import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/authz';

export interface FileEntityContext {
  user: Principal;
  entityId: string;
  /** read: may the user see files attached to this entity? attach: may the user attach files to it? */
  mode: 'read' | 'attach';
}
export type FileEntityResolver = (ctx: FileEntityContext) => Promise<boolean>;

/**
 * Scope inheritance for files: a file is as visible as the entities it is attached to. Domain modules register one
 * resolver per entity type in `onModuleInit`; the resolver MUST enforce org + ownership/team scope for the user (use
 * AccessService.canAccessRecord) and return false for missing records. Unregistered entity types are not attachable.
 */
@Injectable()
export class FileAccessRegistry {
  private readonly resolvers = new Map<string, FileEntityResolver>();

  register(entityType: string, resolver: FileEntityResolver): void {
    this.resolvers.set(entityType, resolver);
  }
  has(entityType: string): boolean {
    return this.resolvers.has(entityType);
  }
  async can(entityType: string, ctx: FileEntityContext): Promise<boolean> {
    const r = this.resolvers.get(entityType);
    if (!r) return false;
    try {
      return await r(ctx);
    } catch {
      return false; // fail closed
    }
  }
  types(): string[] {
    return [...this.resolvers.keys()];
  }
}
