import { Inject, Injectable } from '@nestjs/common';
import { ROLE_KEYS, type RoleKey, type ScopeLevel } from '@salesos/shared-types';
import { catalogueEntries, type Principal } from '../../../common/authz';
import { PermissionResolver } from '../../../common/authz/principal.loader';
import { notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { RUNBOOK } from './access.runbook';

type Mode = 'configured' | 'not configured';
export interface FlagRow {
  key: string;
  group: 'ai' | 'storage' | 'messaging' | 'security' | 'observability' | 'runtime';
  /** Never a secret value: a boolean state, an enumerated mode or a small non-secret number. */
  status: Mode | 'enabled' | 'disabled' | 'on' | 'off' | string;
}

const present = (v: unknown): Mode => (typeof v === 'string' && v.trim() !== '' ? 'configured' : 'not configured');

@Injectable()
export class DevAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  matrix() {
    const entries = catalogueEntries().map((e) => ({
      key: e.key,
      domain: e.domain,
      description: e.description,
      sensitive: e.sensitive,
      grants: e.grants as Record<string, ScopeLevel>,
    }));
    const totals: Record<string, number> = Object.fromEntries(ROLE_KEYS.map((r) => [r, 0]));
    for (const e of entries) for (const r of Object.keys(e.grants)) totals[r] = (totals[r] ?? 0) + 1;
    return {
      roles: [...ROLE_KEYS],
      domains: [...new Set(entries.map((e) => e.domain))].sort(),
      totalPermissions: entries.length,
      totals,
      permissions: entries,
    };
  }

  async userEffective(actor: Principal, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: { id: true, name: true, email: true, isActive: true, roleAssignments: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw notFound('User');
    const roles = [...new Set(user.roleAssignments.map((a) => a.role.key as RoleKey))].sort();
    const eff = this.resolver.effective(roles);
    const meta = new Map(catalogueEntries().map((e) => [e.key, e]));
    const permissions = [...eff.entries()]
      .map(([key, scope]) => {
        const m = meta.get(key);
        // Which of the user's roles contribute the winning scope (answers "why can this person do X").
        const via = roles.filter((r) => m?.grants[r] === scope);
        return { key, scope, domain: m?.domain ?? '', sensitive: m?.sensitive ?? false, via };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    return { user: { id: user.id, name: user.name, email: user.email, isActive: user.isActive }, roles, total: permissions.length, permissions };
  }

  flags() {
    const e = this.env;
    const p = process.env;
    const rows: FlagRow[] = [
      { key: 'AI_OPENAI', group: 'ai', status: present(p.OPENAI_API_KEY) },
      { key: 'AI_GEMINI', group: 'ai', status: present(p.GEMINI_API_KEY) },
      { key: 'AI_ANTHROPIC', group: 'ai', status: present(p.ANTHROPIC_API_KEY) },
      { key: 'STORAGE_S3', group: 'storage', status: e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY && e.S3_SECRET_KEY ? 'configured' : 'not configured' },
      { key: 'STORAGE_ENCRYPTION_KEY', group: 'storage', status: present(e.PLATFORM_ENCRYPTION_KEY) },
      { key: 'FILE_SCANNER', group: 'storage', status: p.FILE_SCANNER === 'clamd' || p.FILE_SCANNER === 'none' ? p.FILE_SCANNER : 'local' },
      { key: 'MESSAGING_PROVIDERS', group: 'messaging', status: 'database-managed' },
      { key: 'THROTTLE_STORAGE', group: 'security', status: e.THROTTLE_STORAGE },
      { key: 'TRUST_PROXY', group: 'security', status: e.TRUST_PROXY ? 'on' : 'off' },
      { key: 'API_DOCS', group: 'security', status: e.docsEnabled ? 'enabled' : 'disabled' },
      { key: 'COOKIE_SAMESITE', group: 'security', status: e.SESSION_COOKIE_SAMESITE },
      { key: 'METRICS_TOKEN', group: 'observability', status: present(e.METRICS_TOKEN) },
      { key: 'ERROR_REPORTING', group: 'observability', status: present(e.SENTRY_DSN) },
      { key: 'ANALYTICS_SCHEDULER', group: 'runtime', status: p.ANALYTICS_SCHEDULER === 'false' ? 'disabled' : 'enabled' },
      { key: 'EXPORT_RUNNER', group: 'runtime', status: p.EXPORT_RUNNER === 'false' ? 'disabled' : 'enabled' },
      { key: 'DB_AUTO_DDL', group: 'runtime', status: (e.DB_AUTO_DDL ?? !e.isProd) ? 'on' : 'off' },
    ];
    return { environment: e.NODE_ENV, flags: rows };
  }

  runbook() {
    return { executesCommands: false, sections: RUNBOOK };
  }
}
