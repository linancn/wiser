import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client, type ClientBase } from 'pg';
import { z } from 'zod';
import {
  buildProjectAccessBootstrapPlan,
  type ProjectAccessBootstrapPlan,
} from './project-access-bootstrap.js';

const Slug = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);
const IsoDate = z.string().datetime({ offset: true });
const Email = z.string().email().max(254);
const BootstrapConfig = z.strictObject({
  tenantSlug: Slug,
  maintenanceActorId: z.string().uuid(),
  sourceProjectSlug: Slug,
  demo: z.strictObject({
    slug: Slug,
    nameZh: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    managerEmail: Email,
    approverEmail: Email,
    applicantEmail: Email,
    expiresAt: IsoDate,
  }),
  researcher: z.strictObject({
    email: Email,
    expiresAt: IsoDate,
  }),
  intake: z.strictObject({
    slug: Slug,
    nameZh: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    expiresAt: IsoDate,
  }),
});
type Db = Pick<ClientBase, 'query'>;
type IdRow = { id: string };
type ProjectRow = IdRow & {
  tenant_id: string;
  name_zh_cn: string;
  name_en: string;
  status: string;
};
type RoleRow = IdRow & {
  role_key: string;
  system_id: string;
  max_security_level: string;
  status: string;
};

const PREVIEW_SCOPES = [
  'data.catalog.read',
  'data.geo.read',
  'data.graph.read',
  'data.knowledge.read',
  'data.query',
  'data.query.execute',
  'data.search.execute',
] as const;

export function verifyReusablePreviewRole(input: {
  readonly systemId: string;
  readonly securityLevel: string;
  readonly scopes: readonly string[];
}) {
  if (
    input.systemId !== 'data' ||
    input.securityLevel !== 'L3_CONFIDENTIAL' ||
    JSON.stringify([...input.scopes].sort()) !== JSON.stringify(PREVIEW_SCOPES)
  )
    throw new Error(
      'Original preview role differs from approved configuration',
    );
}

export function sameExpiry(actual: Date | null, intended: string) {
  return actual?.getTime() === Date.parse(intended);
}

async function audit(
  db: Db,
  input: {
    actorId: string;
    tenantId: string;
    projectId: string | null;
    subjectId: string;
    capability: string;
    reason: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
  },
) {
  const eventId = randomUUID();
  const context = JSON.stringify({
    eventId,
    subjectId: input.subjectId,
    action: input.reason,
  });
  await db.query(
    `insert into platform_private.authorization_audit_events
      (actor_id,tenant_id,project_id,capability,purpose,decision,reason_code,resource_type,resource_id,context)
     values($1,$2,$3,$4,'access-bootstrap','allowed',$5,$6,$7,$8::jsonb)`,
    [
      input.actorId,
      input.tenantId,
      input.projectId,
      input.capability,
      input.reason,
      input.aggregateType,
      input.subjectId,
      context,
    ],
  );
  await db.query(
    `insert into platform_private.control_outbox
      (aggregate_type,aggregate_id,event_type,payload,idempotency_key)
     values($1,$2,$3,$4::jsonb,$5)`,
    [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      context,
      'access-bootstrap:' + eventId,
    ],
  );
}

async function requireTenant(
  db: Db,
  slug: string,
  sourceProjectSlug: string,
  maintenanceActorId: string,
) {
  const result = await db.query<IdRow>(
    `select t.id from platform.tenants t
     join platform.projects p on p.tenant_id=t.id and p.slug=$2 and p.status='active'
     join platform.tenant_memberships m on m.tenant_id=t.id and m.actor_id=$3
     join platform.role_bindings b on b.tenant_id=t.id and b.actor_id=$3 and b.status='active'
       and (b.project_id is null or b.project_id=p.id)
     join platform.roles r on r.id=b.role_id and r.status='active'
     join platform.role_scopes s on s.role_id=r.id and s.scope='platform.project.manage'
     where t.slug=$1 and t.status='active' and m.status='active'
       and m.effective_at<=statement_timestamp()
       and (m.expires_at is null or m.expires_at>statement_timestamp())
       and b.effective_at<=statement_timestamp()
       and (b.expires_at is null or b.expires_at>statement_timestamp())
     limit 1`,
    [slug, sourceProjectSlug, maintenanceActorId],
  );
  if (!result.rows[0])
    throw new Error('Maintenance actor lacks live project authority');
  return result.rows[0].id;
}

async function requireProject(db: Db, tenantId: string, slug: string) {
  const result = await db.query<ProjectRow>(
    `select id,tenant_id,name_zh_cn,name_en,status from platform.projects
     where tenant_id=$1 and slug=$2 for update`,
    [tenantId, slug],
  );
  if (!result.rows[0] || result.rows[0].status !== 'active')
    throw new Error('Source project unavailable');
  return result.rows[0];
}

async function createOrVerifyProject(
  db: Db,
  tenantId: string,
  creatorId: string,
  project: ProjectAccessBootstrapPlan['projects'][number],
) {
  const existing = await db.query<ProjectRow>(
    `select id,tenant_id,name_zh_cn,name_en,status from platform.projects
     where tenant_id=$1 and slug=$2 for update`,
    [tenantId, project.slug],
  );
  const current = existing.rows[0];
  if (current) {
    if (
      current.status !== 'active' ||
      current.name_zh_cn !== project.nameZh ||
      current.name_en !== project.nameEn
    )
      throw new Error('Existing project differs from approved configuration');
    return current.id;
  }
  const id = randomUUID();
  await db.query(
    `insert into platform.projects
      (id,tenant_id,slug,name_zh_cn,name_en,created_by_actor_id)
     values($1,$2,$3,$4,$5,$6)`,
    [id, tenantId, project.slug, project.nameZh, project.nameEn, creatorId],
  );
  await audit(db, {
    actorId: creatorId,
    tenantId,
    projectId: id,
    subjectId: id,
    capability: 'platform.project.manage',
    reason: 'project-created',
    eventType: 'project.created',
    aggregateType: 'project',
    aggregateId: id,
  });
  return id;
}

async function ensureRole(
  db: Db,
  tenantId: string,
  creatorId: string,
  role: ProjectAccessBootstrapPlan['roles'][number],
) {
  const existing = await db.query<RoleRow>(
    `select id,role_key,system_id,max_security_level,status from platform.roles
     where role_key=$1 for update`,
    [role.key],
  );
  const current = existing.rows[0];
  if (current) {
    const scopes = await db.query<{ scope: string }>(
      `select scope from platform.role_scopes where role_id=$1 order by scope`,
      [current.id],
    );
    if (
      current.status !== 'active' ||
      current.system_id !== role.system ||
      current.max_security_level !== role.securityLevel ||
      JSON.stringify(scopes.rows.map((row) => row.scope)) !==
        JSON.stringify([...role.scopes].sort())
    )
      throw new Error('Existing role differs from approved configuration');
    return current.id;
  }
  const id = randomUUID();
  await db.query(
    `insert into platform.roles(id,role_key,system_id,max_security_level)
     values($1,$2,$3,$4)`,
    [id, role.key, role.system, role.securityLevel],
  );
  for (const scope of role.scopes)
    await db.query(
      `insert into platform.role_scopes(role_id,scope) values($1,$2)`,
      [id, scope],
    );
  await audit(db, {
    actorId: creatorId,
    tenantId,
    projectId: null,
    subjectId: id,
    capability: 'platform.project.manage',
    reason: 'role-created',
    eventType: 'platform.role.created',
    aggregateType: 'role',
    aggregateId: id,
  });
  return id;
}

async function ensureAccessSetting(
  db: Db,
  tenantId: string,
  projectId: string,
  creatorId: string,
  requestsEnabled: boolean,
) {
  const current = await db.query<{ requests_enabled: boolean }>(
    `select requests_enabled from platform_private.project_access_settings
     where project_id=$1 for update`,
    [projectId],
  );
  if (current.rows[0]) {
    if (current.rows[0].requests_enabled !== requestsEnabled)
      throw new Error('Existing project access setting differs');
    return;
  }
  await db.query(
    `insert into platform_private.project_access_settings(project_id,requests_enabled)
     values($1,$2)`,
    [projectId, requestsEnabled],
  );
  await audit(db, {
    actorId: creatorId,
    tenantId,
    projectId,
    subjectId: projectId,
    capability: 'platform.project.manage',
    reason: 'access-configured',
    eventType: 'project.access.configured',
    aggregateType: 'project',
    aggregateId: projectId,
  });
}

async function ensureAssignablePreview(
  db: Db,
  tenantId: string,
  projectId: string,
  roleId: string,
  creatorId: string,
) {
  const current = await db.query<{ max_days: number }>(
    `select max_days from platform_private.project_access_roles
     where project_id=$1 and role_id=$2 for update`,
    [projectId, roleId],
  );
  if (current.rows[0]) {
    if (current.rows[0].max_days !== 7)
      throw new Error('Existing assignable role duration differs');
    return;
  }
  await db.query(
    `insert into platform_private.project_access_roles(project_id,role_id,max_days)
     values($1,$2,7)`,
    [projectId, roleId],
  );
  await audit(db, {
    actorId: creatorId,
    tenantId,
    projectId,
    subjectId: roleId,
    capability: 'platform.project.manage',
    reason: 'assignable-role-configured',
    eventType: 'project.access.role-configured',
    aggregateType: 'project',
    aggregateId: projectId,
  });
}

async function requireActor(db: Db, email: string) {
  const result = await db.query<IdRow>(
    `select a.id from auth.users u join platform.actors a on a.auth_user_id=u.id
     where lower(u.email)=lower($1) and a.actor_type='human' and a.status='active'`,
    [email],
  );
  if (!result.rows[0])
    throw new Error('Required personal account is unavailable');
  return result.rows[0].id;
}

async function requireExistingSourceRole(
  db: Db,
  sourceId: string,
  actorId: string,
  requiredRoleId: string,
  expiresAt: string,
) {
  const result = await db.query<IdRow>(
    `select m.actor_id id from platform.project_memberships m
     join platform.role_bindings b on b.project_id=m.project_id and b.actor_id=m.actor_id
     where m.project_id=$1 and m.actor_id=$2 and m.status='active'
       and m.effective_at<=statement_timestamp()
       and (m.expires_at is null or m.expires_at >= $4::timestamptz)
       and b.role_id=$3 and b.status='active'
       and b.effective_at<=statement_timestamp()
       and (b.expires_at is null or b.expires_at >= $4::timestamptz)
     limit 1`,
    [sourceId, actorId, requiredRoleId, expiresAt],
  );
  if (!result.rows[0])
    throw new Error('Source membership or role expiry differs');
}

async function ensureMembership(
  db: Db,
  tenantId: string,
  projectId: string,
  actorId: string,
  expiresAt: string,
) {
  const tenant = await db.query<{ status: string; expires_at: Date | null }>(
    `select status,expires_at from platform.tenant_memberships
     where tenant_id=$1 and actor_id=$2 for update`,
    [tenantId, actorId],
  );
  if (tenant.rows[0]) {
    if (
      tenant.rows[0].status !== 'active' ||
      (tenant.rows[0].expires_at &&
        tenant.rows[0].expires_at.getTime() < Date.parse(expiresAt))
    )
      throw new Error('Tenant membership conflicts with requested expiry');
  } else {
    await db.query(
      `insert into platform.tenant_memberships
        (tenant_id,actor_id,status,expires_at) values($1,$2,'active',$3)`,
      [tenantId, actorId, expiresAt],
    );
  }
  const project = await db.query<{ status: string; expires_at: Date | null }>(
    `select status,expires_at from platform.project_memberships
     where project_id=$1 and actor_id=$2 for update`,
    [projectId, actorId],
  );
  if (project.rows[0]) {
    if (
      project.rows[0].status !== 'active' ||
      !sameExpiry(project.rows[0].expires_at, expiresAt)
    )
      throw new Error('Project membership conflicts with requested expiry');
  } else {
    await db.query(
      `insert into platform.project_memberships
        (project_id,tenant_id,actor_id,status,expires_at)
       values($1,$2,$3,'active',$4)`,
      [projectId, tenantId, actorId, expiresAt],
    );
  }
  return !project.rows[0];
}

async function ensureBinding(
  db: Db,
  input: {
    tenantId: string;
    projectId: string;
    actorId: string;
    roleId: string;
    roleKey: string;
    expiresAt: string;
    creatorId: string;
  },
) {
  const current = await db.query<{ expires_at: Date | null }>(
    `select expires_at from platform.role_bindings
     where project_id=$1 and actor_id=$2 and role_id=$3 and status='active'
     for update`,
    [input.projectId, input.actorId, input.roleId],
  );
  if (current.rows.length) {
    if (
      current.rows.length !== 1 ||
      !sameExpiry(current.rows[0]!.expires_at, input.expiresAt)
    )
      throw new Error('Existing role binding conflicts with approved expiry');
    return false;
  }
  const id = randomUUID();
  await db.query(
    `insert into platform.role_bindings
      (id,actor_id,tenant_id,project_id,role_id,expires_at,created_by_actor_id)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.actorId,
      input.tenantId,
      input.projectId,
      input.roleId,
      input.expiresAt,
      input.creatorId,
    ],
  );
  const eventId = randomUUID();
  await db.query(
    `insert into platform_private.project_access_events
      (id,project_id,actor_id,subject_id,action,reason,before_state,after_state)
     values($1,$2,$3,$4,'grant',$5,$6::jsonb,$7::jsonb)`,
    [
      eventId,
      input.projectId,
      input.creatorId,
      input.actorId,
      'Approved scoped bootstrap appointment',
      JSON.stringify({ roleKey: input.roleKey, status: 'absent' }),
      JSON.stringify({ roleKey: input.roleKey, expiresAt: input.expiresAt }),
    ],
  );
  await audit(db, {
    actorId: input.creatorId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    subjectId: input.actorId,
    capability: 'platform.project.manage',
    reason: 'bootstrap-appointment',
    eventType: 'project.member.grant',
    aggregateType: 'project',
    aggregateId: input.projectId,
  });
  return true;
}

export async function runProjectAccessBootstrap(file: string, apply: boolean) {
  const privateFile = resolve(file);
  const fileStat = await lstat(privateFile);
  if (
    !fileStat.isFile() ||
    (fileStat.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && fileStat.uid !== process.getuid())
  )
    throw new Error('Private configuration file required');
  const config = BootstrapConfig.parse(
    JSON.parse(await readFile(privateFile, 'utf8')),
  );
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('begin isolation level serializable');
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      'project-access-bootstrap:' + config.tenantSlug,
    ]);
    const now = await client.query<{ now: Date }>(
      'select statement_timestamp() now',
    );
    const plan = buildProjectAccessBootstrapPlan(
      config,
      now.rows[0]!.now.toISOString(),
    );
    const tenantId = await requireTenant(
      client,
      config.tenantSlug,
      plan.sourceProjectSlug,
      config.maintenanceActorId,
    );
    const source = await requireProject(
      client,
      tenantId,
      plan.sourceProjectSlug,
    );
    const sourceResourceSetting = await client.query<IdRow>(
      `select project_id id from platform_private.resource_access_settings
       where project_id=$1`,
      [source.id],
    );
    if (sourceResourceSetting.rows.length)
      throw new Error('Source project resource mode changed; replan');
    const preview = await client.query<RoleRow>(
      `select id,role_key,system_id,max_security_level,status from platform.roles where role_key='data-project-preview'
       and status='active'`,
    );
    if (!preview.rows[0]) throw new Error('Original preview role unavailable');
    const previewScopes = await client.query<{ scope: string }>(
      `select scope from platform.role_scopes where role_id=$1 order by scope`,
      [preview.rows[0].id],
    );
    verifyReusablePreviewRole({
      systemId: preview.rows[0].system_id,
      securityLevel: preview.rows[0].max_security_level,
      scopes: previewScopes.rows.map((row) => row.scope),
    });
    const actors = new Map<string, string>();
    for (const assignment of plan.assignments) {
      if (!actors.has(assignment.email))
        actors.set(
          assignment.email,
          await requireActor(client, assignment.email),
        );
    }
    for (const item of plan.assignments.filter(
      (assignment) => assignment.projectSlug === config.demo.slug,
    )) {
      await requireExistingSourceRole(
        client,
        source.id,
        actors.get(item.email)!,
        preview.rows[0].id,
        item.expiresAt,
      );
    }
    const projects = new Map<string, string>([
      [plan.sourceProjectSlug, source.id],
    ]);
    for (const project of plan.projects) {
      const id = await createOrVerifyProject(
        client,
        tenantId,
        config.maintenanceActorId,
        project,
      );
      projects.set(project.slug, id);
      await ensureAccessSetting(
        client,
        tenantId,
        id,
        config.maintenanceActorId,
        project.requestsEnabled,
      );
    }
    const roles = new Map<string, string>([
      ['data-project-preview', preview.rows[0].id],
    ]);
    for (const role of plan.roles)
      roles.set(
        role.key,
        await ensureRole(client, tenantId, config.maintenanceActorId, role),
      );
    await requireExistingSourceRole(
      client,
      source.id,
      actors.get(config.researcher.email)!,
      roles.get('researcher-read-delegate')!,
      config.researcher.expiresAt,
    );
    await ensureAssignablePreview(
      client,
      tenantId,
      projects.get(config.demo.slug)!,
      preview.rows[0].id,
      config.maintenanceActorId,
    );
    const changedActors = new Map<string, Set<string>>();
    for (const assignment of plan.assignments) {
      const projectId = projects.get(assignment.projectSlug)!;
      const actorId = actors.get(assignment.email)!;
      const memberCreated = await ensureMembership(
        client,
        tenantId,
        projectId,
        actorId,
        assignment.expiresAt,
      );
      const roleCreated = await ensureBinding(client, {
        tenantId,
        projectId,
        actorId,
        roleId: roles.get(assignment.roleKey)!,
        roleKey: assignment.roleKey,
        expiresAt: assignment.expiresAt,
        creatorId: config.maintenanceActorId,
      });
      if (memberCreated || roleCreated) {
        if (!changedActors.has(actorId)) changedActors.set(actorId, new Set());
        changedActors.get(actorId)!.add(projectId);
      }
    }
    for (const [actorId, projectIds] of changedActors)
      for (const projectId of projectIds)
        await client.query(
          `update platform.actors a set authz_version=greatest(a.authz_version,
           (select version from platform.projects where id=$2),
           (select version from platform.tenants where id=$3),
           (select membership_version from platform.project_memberships where project_id=$2 and actor_id=$1),
           (select membership_version from platform.tenant_memberships where tenant_id=$3 and actor_id=$1))+1,
           updated_at=statement_timestamp() where a.id=$1`,
          [actorId, projectId, tenantId],
        );
    if (apply) await client.query('commit');
    else await client.query('rollback');
    return {
      applied: apply,
      sourceProjectId: source.id,
      projects: Object.fromEntries(projects),
      assignments: plan.assignments.map((assignment) => ({
        projectSlug: assignment.projectSlug,
        roleKey: assignment.roleKey,
        expiresAt: assignment.expiresAt,
      })),
      changedActorCount: changedActors.size,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
