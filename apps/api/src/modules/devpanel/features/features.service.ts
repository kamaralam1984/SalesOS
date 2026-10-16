import { Injectable } from '@nestjs/common';
import { ROLE_KEYS, SCOPE_RANK, type RoleKey, type ScopeLevel } from '@salesos/shared-types';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { type Principal } from '../../../common/authz';
import { PERMISSION_CATALOGUE, isKnownPermission } from '../../../common/authz/permissions.catalogue';
import { applyOverrides, isProtectedKey, PermissionResolver } from '../../../common/authz/principal.loader';
import { AppError, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';

export type SubjectType = 'ROLE' | 'USER';
export type FeatureState = 'DEFAULT' | 'ON' | 'OFF';
export interface FeatureChange {
  permissionKey: string;
  state: FeatureState;
  scope?: ScopeLevel;
}

interface Subject {
  type: SubjectType;
  key: string;
  label: string;
  roles: RoleKey[];
}

/**
 * Developer Panel "Feature access": ON/OFF for one permission key per role or per user, layered over the code catalogue.
 * The server stays the authority: every endpoint still checks the caller's permissions through the normal policy layer;
 * this only changes what a role or user is granted. devpanel:* keys and the DEVELOPER role are never overridable.
 */
@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly resolver: PermissionResolver) {}

  private async subject(actor: Principal, type: SubjectType, key: string, forWrite: boolean): Promise<Subject> {
    if (type === 'ROLE') {
      if (!(ROLE_KEYS as readonly string[]).includes(key)) throw new AppError('VALIDATION_ERROR', 'Unknown role', 422, [{ path: 'subject', message: 'unknown role' }]);
      if (key === 'DEVELOPER' && forWrite) throw new AppError('SUBJECT_PROTECTED', 'The Developer role is managed only by role assignment', 409);
      return { type, key, label: key, roles: [key as RoleKey] };
    }
    const user = await this.prisma.user.findFirst({
      where: { id: key, organizationId: actor.organizationId },
      select: { id: true, name: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw notFound('User');
    const roles = [...new Set(user.roleAssignments.map((a) => a.role.key as RoleKey))];
    if (forWrite) {
      if (user.id === actor.userId) throw new AppError('CANNOT_CHANGE_OWN_FEATURES', 'You cannot change your own feature access', 403);
      if (roles.includes('DEVELOPER')) throw new AppError('SUBJECT_PROTECTED', 'A Developer\'s access is managed only by role assignment', 409);
    }
    return { type, key, label: user.name, roles };
  }

  /** Every permission with: catalogue/inherited default, this subject's override, and the resulting effective scope. */
  async view(actor: Principal, type: SubjectType, key: string) {
    const subject = await this.subject(actor, type, key, false);
    const rows = await this.prisma.featureOverride.findMany({ where: { organizationId: actor.organizationId }, select: { subjectType: true, subjectKey: true, permissionKey: true, effect: true, scope: true } });
    // default = what the subject gets without an override of its own: a role -> catalogue; a user -> its roles incl. role overrides
    const defaults = applyOverrides(subject.roles, type === 'ROLE' ? [] : rows, undefined);
    const effective = type === 'ROLE' ? applyOverrides(subject.roles, rows, undefined) : applyOverrides(subject.roles, rows, subject.key);
    const own = new Map(rows.filter((r) => r.subjectType === type && r.subjectKey === key).map((r) => [r.permissionKey, r]));
    const permissions = PERMISSION_CATALOGUE.map((p) => {
      const o = own.get(p.key);
      return {
        key: p.key,
        domain: p.domain,
        description: p.description,
        sensitive: p.sensitive ?? false,
        locked: isProtectedKey(p.key),
        default: defaults.get(p.key) ?? null,
        override: o ? { effect: o.effect as 'GRANT' | 'DENY', scope: (o.scope as ScopeLevel | null) ?? null } : null,
        effective: effective.get(p.key) ?? null,
      };
    });
    return {
      subject: { type, key, label: subject.label, roles: subject.roles },
      overrides: own.size,
      total: permissions.length,
      enabled: permissions.filter((p) => p.effective).length,
      permissions,
    };
  }

  /** Subjects that have at least one override (for the page's "customised" list). */
  async summary(actor: Principal) {
    const rows = await this.prisma.featureOverride.groupBy({ by: ['subjectType', 'subjectKey', 'effect'], where: { organizationId: actor.organizationId }, _count: { _all: true } });
    const map = new Map<string, { type: string; key: string; grants: number; denies: number }>();
    for (const r of rows) {
      const id = `${r.subjectType}:${r.subjectKey}`;
      const cur = map.get(id) ?? { type: r.subjectType, key: r.subjectKey, grants: 0, denies: 0 };
      if (r.effect === 'GRANT') cur.grants += r._count._all;
      else cur.denies += r._count._all;
      map.set(id, cur);
    }
    const userIds = [...map.values()].filter((m) => m.type === 'USER').map((m) => m.key);
    const users = userIds.length ? await this.prisma.user.findMany({ where: { organizationId: actor.organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { subjects: [...map.values()].map((m) => ({ ...m, label: m.type === 'USER' ? (names.get(m.key) ?? m.key) : m.key })) };
  }

  /** Apply a batch of switches in one transaction. */
  async change(actor: Principal, type: SubjectType, key: string, changes: FeatureChange[], confirmSensitive: boolean) {
    const org = actor.organizationId;
    const subject = await this.subject(actor, type, key, true);
    const seen = new Set<string>();
    for (const c of changes) {
      if (!isKnownPermission(c.permissionKey)) throw new AppError('VALIDATION_ERROR', `Unknown feature ${c.permissionKey}`, 422, [{ path: 'permissionKey', message: 'unknown' }]);
      if (isProtectedKey(c.permissionKey)) throw new AppError('FEATURE_LOCKED', `${c.permissionKey} is managed only through the Developer role`, 409);
      if (seen.has(c.permissionKey)) throw new AppError('VALIDATION_ERROR', `Duplicate feature ${c.permissionKey}`, 422);
      seen.add(c.permissionKey);
    }
    const rows = await this.prisma.featureOverride.findMany({ where: { organizationId: org }, select: { subjectType: true, subjectKey: true, permissionKey: true, effect: true, scope: true } });
    const base = applyOverrides(subject.roles, type === 'ROLE' ? [] : rows, undefined);
    const sensitiveKeys = new Set(PERMISSION_CATALOGUE.filter((p) => p.sensitive).map((p) => p.key as string));

    type Plan = { permissionKey: string; action: 'delete' | 'set'; effect?: 'GRANT' | 'DENY'; scope?: ScopeLevel; from: string; to: string };
    const plan: Plan[] = [];
    const needConfirm: string[] = [];
    const current = new Map(rows.filter((r) => r.subjectType === type && r.subjectKey === key).map((r) => [r.permissionKey, r]));
    for (const c of changes) {
      const def = base.get(c.permissionKey) ?? null;
      const cur = current.get(c.permissionKey);
      const from = cur ? (cur.effect === 'DENY' ? 'OFF' : `ON:${cur.scope ?? 'own'}`) : 'DEFAULT';
      if (c.state === 'DEFAULT') {
        if (cur) plan.push({ permissionKey: c.permissionKey, action: 'delete', from, to: 'DEFAULT' });
      } else if (c.state === 'OFF') {
        // nothing to remove: no override needed when the subject does not have it anyway
        if (!def) { if (cur) plan.push({ permissionKey: c.permissionKey, action: 'delete', from, to: 'DEFAULT' }); continue; }
        plan.push({ permissionKey: c.permissionKey, action: 'set', effect: 'DENY', from, to: 'OFF' });
      } else {
        const scope = c.scope ?? def ?? 'own';
        if (def && def === scope) { if (cur) plan.push({ permissionKey: c.permissionKey, action: 'delete', from, to: 'DEFAULT' }); continue; }
        // a sensitive feature the subject did not have, or a wider scope of one it had, needs an explicit second confirmation
        if (sensitiveKeys.has(c.permissionKey) && (!def || SCOPE_RANK[scope] > SCOPE_RANK[def])) needConfirm.push(c.permissionKey);
        plan.push({ permissionKey: c.permissionKey, action: 'set', effect: 'GRANT', scope, from, to: `ON:${scope}` });
      }
    }
    if (needConfirm.length && !confirmSensitive) {
      throw new AppError('CONFIRM_SENSITIVE', 'Granting sensitive features (payroll, payments, HR, recordings...) needs explicit confirmation', 409, needConfirm.map((k) => ({ path: k, message: 'sensitive' })));
    }
    if (!plan.length) return this.view(actor, type, key);

    await this.prisma.$transaction(async (tx) => {
      for (const p of plan) {
        const where = { organizationId_subjectType_subjectKey_permissionKey: { organizationId: org, subjectType: type, subjectKey: key, permissionKey: p.permissionKey } };
        if (p.action === 'delete') await tx.featureOverride.deleteMany({ where: { organizationId: org, subjectType: type, subjectKey: key, permissionKey: p.permissionKey } });
        else {
          await tx.featureOverride.upsert({
            where,
            create: { organizationId: org, subjectType: type, subjectKey: key, permissionKey: p.permissionKey, effect: p.effect!, scope: p.effect === 'GRANT' ? p.scope! : null, createdById: actor.userId },
            update: { effect: p.effect!, scope: p.effect === 'GRANT' ? p.scope! : null },
          });
        }
      }
      await this.audit.recordTx(tx, {
        organizationId: org,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.DEVPANEL_FEATURES_CHANGED,
        entityType: type === 'ROLE' ? 'role' : 'user',
        entityId: type === 'USER' ? key : undefined,
        metadata: { subjectType: type, subject: key, label: subject.label, changes: plan.map((p) => ({ feature: p.permissionKey, from: p.from, to: p.to })) },
      });
    });
    this.resolver.invalidate(org);
    return this.view(actor, type, key);
  }

  /** Remove every override of one subject (back to catalogue defaults). */
  async reset(actor: Principal, type: SubjectType, key: string) {
    const org = actor.organizationId;
    const subject = await this.subject(actor, type, key, true);
    const removed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.featureOverride.deleteMany({ where: { organizationId: org, subjectType: type, subjectKey: key } });
      if (res.count > 0) {
        await this.audit.recordTx(tx, { organizationId: org, actorId: actor.userId, action: AUDIT_ACTIONS.DEVPANEL_FEATURES_RESET, entityType: type === 'ROLE' ? 'role' : 'user', entityId: type === 'USER' ? key : undefined, metadata: { subjectType: type, subject: key, label: subject.label, removed: res.count } });
      }
      return res.count;
    });
    this.resolver.invalidate(org);
    return { removed };
  }
}
