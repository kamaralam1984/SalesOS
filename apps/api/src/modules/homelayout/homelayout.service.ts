import { Injectable } from '@nestjs/common';
import { getSetting, putSetting } from '@salesos/platform-core';
import { ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import { DEFAULT_HOME_WIDGETS, HOME_WIDGET_META, HOME_WIDGETS, normaliseHomeWidgets, type HomeLayoutInput, type HomeWidgetEntry, type HomeWidgetId } from '@salesos/validation';
import { AuditService } from '../../common/audit/audit.service';
import type { Principal } from '../../common/authz';
import { grantsForRole } from '../../common/authz/permissions.catalogue';
import { AppError } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';

const KEY = 'homeLayout';
/** The sales roles that get the calling widgets (mirrors the web app's call-team rule). */
const CALL_TEAM: readonly RoleKey[] = ['SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD'];
/** Roles an editor can set a layout for (DEVELOPER is the editor, not an audience). */
export const LAYOUT_ROLES: readonly RoleKey[] = ROLE_KEYS.filter((r) => r !== 'DEVELOPER');
/** When a person holds several roles the first role in this list that has a saved layout wins. */
const PRIORITY: readonly RoleKey[] = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'ADMIN', 'HR', 'FINANCE', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS', 'DEVELOPER'];

type Stored = { roles?: Partial<Record<RoleKey, unknown>> };

@Injectable()
export class HomeLayoutService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async stored(organizationId: string): Promise<Stored> {
    return getSetting<Stored>(this.prisma, organizationId, KEY, {});
  }

  /** Widgets that make sense for a role: it holds the permissions they need (and, for calling widgets, a sales calling role). */
  applicable(role: RoleKey): HomeWidgetId[] {
    const grants = grantsForRole(role);
    return HOME_WIDGETS.filter((id) => {
      const m = HOME_WIDGET_META[id];
      return m.requires.every((p) => grants[p]) && (!m.callTeam || CALL_TEAM.includes(role));
    });
  }

  /** The caller's own layout: the first of their roles that has a saved layout, else the built-in default. */
  async mine(user: Principal) {
    const st = await this.stored(user.organizationId);
    const role = PRIORITY.find((r) => user.roles.includes(r) && st.roles?.[r] !== undefined);
    return role
      ? { source: 'ROLE' as const, role, widgets: normaliseHomeWidgets(st.roles?.[role]) }
      : { source: 'DEFAULT' as const, role: null, widgets: DEFAULT_HOME_WIDGETS.map((w) => ({ ...w })) };
  }

  /** Every role's layout for the editor and the phone previews. */
  async overview(user: Principal) {
    const st = await this.stored(user.organizationId);
    return {
      widgets: HOME_WIDGETS.map((id) => ({ id, requires: HOME_WIDGET_META[id].requires, callTeam: Boolean(HOME_WIDGET_META[id].callTeam) })),
      roles: LAYOUT_ROLES.map((role) => ({
        role,
        customised: st.roles?.[role] !== undefined,
        widgets: st.roles?.[role] !== undefined ? normaliseHomeWidgets(st.roles[role]) : DEFAULT_HOME_WIDGETS.map((w) => ({ ...w })),
        applicable: this.applicable(role),
      })),
    };
  }

  async save(user: Principal, role: RoleKey, dto: HomeLayoutInput) {
    if (!LAYOUT_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', 'Unknown role', 400);
    const widgets: HomeWidgetEntry[] = normaliseHomeWidgets(dto.widgets);
    const st = await this.stored(user.organizationId);
    await putSetting(this.prisma, user.organizationId, KEY, { ...st, roles: { ...(st.roles ?? {}), [role]: widgets } }, user.userId);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'home_layout.saved', entityType: 'platform_setting', entityId: KEY, metadata: { role, widgets: widgets.map((w) => `${w.id}:${w.visible ? w.size : 'hidden'}`) } });
    return { role, customised: true, widgets };
  }

  async reset(user: Principal, role: RoleKey) {
    if (!LAYOUT_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', 'Unknown role', 400);
    const st = await this.stored(user.organizationId);
    const roles = { ...(st.roles ?? {}) };
    delete roles[role];
    await putSetting(this.prisma, user.organizationId, KEY, { ...st, roles }, user.userId);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'home_layout.reset', entityType: 'platform_setting', entityId: KEY, metadata: { role } });
    return { role, customised: false, widgets: DEFAULT_HOME_WIDGETS.map((w) => ({ ...w })) };
  }
}
