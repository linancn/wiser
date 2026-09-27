import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProjectAccessBootstrapPlan } from '../src/platform/project-access-bootstrap.js';
import { runProjectAccessBootstrap } from '../src/platform/project-access-bootstrap-runtime.js';

const database = vi.hoisted(() => ({
  query: vi.fn(),
  close: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    query = database.query;
    end = database.close;
  },
}));

const now = '2026-09-26T00:00:00.000Z';
const config = {
  tenantSlug: 'test-tenant',
  maintenanceActorId: '10000000-0000-4000-8000-000000000001',
  sourceProjectSlug: 'source-project',
  demo: {
    slug: 'demo-project',
    nameZh: '测试演示',
    nameEn: 'Test demo',
    managerEmail: 'manager@example.test',
    approverEmail: 'approver@example.test',
    applicantEmail: 'applicant@example.test',
    expiresAt: '2026-09-30T00:00:00.000Z',
  },
  researcher: {
    email: 'researcher@example.test',
    expiresAt: '2026-10-20T00:00:00.000Z',
  },
  intake: {
    slug: 'intake-project',
    nameZh: '测试接收',
    nameEn: 'Test intake',
    expiresAt: '2026-10-20T00:00:00.000Z',
  },
};
const previewScopes = [
  'data.catalog.read',
  'data.geo.read',
  'data.graph.read',
  'data.knowledge.read',
  'data.query',
  'data.query.execute',
  'data.search.execute',
];

// This transaction double exercises the CLI's commit/rollback contract and
// complete-plan validation. Real PostgreSQL constraints remain integration gates.
function preparedDatabase(
  options: {
    readonly existingAppointments?: boolean;
    readonly denied?: boolean;
    readonly failOnGrant?: boolean;
    readonly missingResearcherSourceRole?: boolean;
  } = {},
) {
  const plan = buildProjectAccessBootstrapPlan(config, now);
  const projects = [
    { slug: config.sourceProjectSlug, nameZh: '原项目', nameEn: 'Source' },
    ...plan.projects,
  ];
  const roles = [
    {
      key: 'data-project-preview',
      system: 'data',
      securityLevel: 'L3_CONFIDENTIAL',
      scopes: previewScopes,
    },
    ...plan.roles,
  ];
  type Mutation = { table: string; values: unknown[] };
  const committed: Mutation[] = [];
  let pending: Mutation[] = [];
  let rolledBack = false;
  database.query.mockImplementation(
    (statement: string, values: unknown[] = []) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      const rows = (items: object[]) => ({ rows: items });
      if (sql === 'commit') {
        committed.push(...pending);
        pending = [];
        return rows([]);
      }
      if (sql === 'rollback') {
        pending = [];
        rolledBack = true;
        return rows([]);
      }
      if (/^(begin|set local|select pg_advisory)/.test(sql)) return rows([]);
      if (sql === 'select statement_timestamp() now')
        return rows([{ now: new Date(now) }]);
      const mutation = sql.match(/^(?:insert into|update) ([a-z_.]+)/);
      if (mutation) {
        if (options.failOnGrant && mutation[1] === 'platform.role_bindings')
          throw new Error('simulated grant constraint failure');
        pending.push({ table: mutation[1]!, values });
        return rows([]);
      }
      if (sql.startsWith('select t.id from platform.tenants'))
        return rows(options.denied ? [] : [{ id: 'tenant' }]);
      if (sql.includes('from platform.projects')) {
        const project = projects.find((item) => item.slug === values[1]);
        return rows(
          project
            ? [
                {
                  id: project.slug,
                  tenant_id: 'tenant',
                  name_zh_cn: project.nameZh,
                  name_en: project.nameEn,
                  status: 'active',
                },
              ]
            : [],
        );
      }
      if (sql.includes('from platform_private.resource_access_settings'))
        return rows([]);
      if (sql.includes('from platform.roles')) {
        const role = roles.find(
          (item) => item.key === (values[0] ?? 'data-project-preview'),
        );
        return rows(
          role
            ? [
                {
                  id: role.key,
                  role_key: role.key,
                  system_id: role.system,
                  max_security_level: role.securityLevel,
                  status: 'active',
                },
              ]
            : [],
        );
      }
      if (sql.includes('from platform.role_scopes'))
        return rows(
          [...roles.find((item) => item.key === values[0])!.scopes]
            .sort()
            .map((scope) => ({ scope })),
        );
      if (sql.includes('from auth.users'))
        return rows([{ id: String(values[0]) }]);
      if (sql.startsWith('select m.actor_id')) {
        const researcherSourceRole =
          values[1] === config.researcher.email &&
          values[2] === 'researcher-read-delegate';
        return rows(
          values[1] === config.researcher.email &&
            (!researcherSourceRole || options.missingResearcherSourceRole)
            ? []
            : [{ id: String(values[1]) }],
        );
      }
      if (sql.includes('from platform_private.project_access_settings'))
        return rows([{ requests_enabled: values[0] === config.demo.slug }]);
      if (sql.includes('from platform_private.project_access_roles'))
        return rows([{ max_days: 7 }]);
      if (sql.includes('from platform.tenant_memberships'))
        return rows([{ status: 'active', expires_at: null }]);
      if (
        sql.includes('from platform.project_memberships') ||
        sql.includes('from platform.role_bindings')
      ) {
        const assignment = plan.assignments.find(
          (item) => item.projectSlug === values[0] && item.email === values[1],
        );
        return rows(
          options.existingAppointments && assignment
            ? [{ status: 'active', expires_at: new Date(assignment.expiresAt) }]
            : [],
        );
      }
      throw new Error('Unexpected bootstrap database operation');
    },
  );
  return { committed, rolledBack: () => rolledBack };
}

describe('private bootstrap transaction', () => {
  let directory: string;
  let file: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic.invalid/isolated');
    directory = await mkdtemp(join(tmpdir(), 'wiser-bootstrap-transaction-'));
    file = join(directory, 'config.json');
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('reports the bounded proposal while dry-run leaves no committed grants or audits', async () => {
    const state = preparedDatabase();
    const result = await runProjectAccessBootstrap(file, false);
    expect(result.applied).toBe(false);
    expect(result.changedActorCount).toBe(4);
    expect(result.assignments).toHaveLength(6);
    expect(Object.keys(result.projects)).toEqual([
      'source-project',
      'demo-project',
      'intake-project',
    ]);
    expect(JSON.stringify(result)).not.toContain('@example.test');
    expect(state.committed).toEqual([]);
    expect(state.rolledBack()).toBe(true);
    expect(database.close).toHaveBeenCalled();
  });

  it('retains already matching appointments without adding grants, audits or expiry extensions', async () => {
    const state = preparedDatabase({ existingAppointments: true });
    const result = await runProjectAccessBootstrap(file, true);
    expect(result.applied).toBe(true);
    expect(result.changedActorCount).toBe(0);
    expect(state.committed).toEqual([]);
    expect(database.close).toHaveBeenCalled();
  });

  it('commits only the six scoped appointments with their audit trail', async () => {
    const state = preparedDatabase();
    const result = await runProjectAccessBootstrap(file, true);
    expect(result.changedActorCount).toBe(4);
    const grants = state.committed.filter(
      (entry) => entry.table === 'platform.role_bindings',
    );
    expect(
      grants.map((entry) => ({
        actor: entry.values[1],
        project: entry.values[3],
        role: entry.values[4],
        expiresAt: entry.values[5],
      })),
    ).toEqual(
      buildProjectAccessBootstrapPlan(config, now).assignments.map((item) => ({
        actor: item.email,
        project: item.projectSlug,
        role: item.roleKey,
        expiresAt: item.expiresAt,
      })),
    );
    expect(
      state.committed.filter(
        (entry) => entry.table === 'platform_private.project_access_events',
      ),
    ).toHaveLength(6);
    expect(
      state.committed.some((entry) => entry.table.startsWith('auth.')),
    ).toBe(false);
    expect(state.rolledBack()).toBe(false);
  });

  it('rejects absent live maintenance authority before committing any change', async () => {
    const state = preparedDatabase({ denied: true });
    await expect(runProjectAccessBootstrap(file, true)).rejects.toThrow(
      'Maintenance actor lacks live project authority',
    );
    expect(state.committed).toEqual([]);
    expect(state.rolledBack()).toBe(true);
    expect(database.close).toHaveBeenCalled();
  });

  it('rejects source write access when the researcher no longer has the source read role', async () => {
    const state = preparedDatabase({ missingResearcherSourceRole: true });
    await expect(runProjectAccessBootstrap(file, true)).rejects.toThrow(
      'Original preview membership or expiry differs',
    );
    expect(state.committed).toEqual([]);
    expect(state.rolledBack()).toBe(true);
  });

  it('rolls back a tentative membership when granting a role fails', async () => {
    const state = preparedDatabase({ failOnGrant: true });
    await expect(runProjectAccessBootstrap(file, true)).rejects.toThrow(
      'simulated grant constraint failure',
    );
    expect(state.committed).toEqual([]);
    expect(state.rolledBack()).toBe(true);
    expect(database.close).toHaveBeenCalled();
  });
});
