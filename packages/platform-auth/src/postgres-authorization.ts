import type { AuthorizedContext } from '@wiser/platform-contracts';

import type {
  AuthorizationContextLoader,
  AuthorizationContextLoadInput,
} from './index.js';

export interface AuthorizationRow {
  readonly tenant_id: string;
  readonly project_id: string;
  readonly roles: readonly string[] | null;
  readonly scopes: readonly string[] | null;
  readonly authz_version: number | string;
}

export type AuthorizationQuery = (
  text: string,
  values: readonly unknown[],
) => Promise<{ readonly rows: readonly AuthorizationRow[] }>;

const loadAuthorizationSql = `
select
  tenant.id as tenant_id,
  project.id as project_id,
  coalesce(
    array_agg(distinct role.role_key order by role.role_key)
      filter (where role.role_key is not null),
    array[]::text[]
  ) as roles,
  coalesce(
    array_agg(distinct role_scope.scope order by role_scope.scope)
      filter (where role_scope.scope is not null),
    array[]::text[]
  ) as scopes,
  greatest(
    actor.authz_version,
    tenant.version,
    project.version,
    tenant_membership.membership_version,
    project_membership.membership_version
  ) as authz_version
from platform.actors as actor
join auth.sessions as session
  on session.id = $2::uuid
 and session.user_id = actor.auth_user_id
join platform.tenant_memberships as tenant_membership
  on tenant_membership.actor_id = actor.id
 and tenant_membership.tenant_id = $3::uuid
 and tenant_membership.status = 'active'
 and tenant_membership.effective_at <= now()
 and (
   tenant_membership.expires_at is null
   or tenant_membership.expires_at > now()
 )
join platform.tenants as tenant
  on tenant.id = tenant_membership.tenant_id
 and tenant.status = 'active'
join platform.project_memberships as project_membership
  on project_membership.actor_id = actor.id
 and project_membership.tenant_id = tenant.id
 and project_membership.project_id = $4::uuid
 and project_membership.status = 'active'
 and project_membership.effective_at <= now()
 and (
   project_membership.expires_at is null
   or project_membership.expires_at > now()
 )
join platform.projects as project
  on project.id = project_membership.project_id
 and project.tenant_id = tenant.id
 and project.status = 'active'
left join platform.role_bindings as binding
  on binding.actor_id = actor.id
 and binding.tenant_id = tenant.id
 and (binding.project_id is null or binding.project_id = project.id)
 and binding.status = 'active'
 and binding.effective_at <= now()
 and (binding.expires_at is null or binding.expires_at > now())
left join platform.roles as role
  on role.id = binding.role_id
 and role.status = 'active'
left join platform.role_scopes as role_scope
  on role_scope.role_id = role.id
where actor.id = $1::uuid
  and actor.actor_type = 'human'
  and actor.status = 'active'
group by
  actor.authz_version,
  tenant.id,
  tenant.version,
  project.id,
  project.version,
  tenant_membership.membership_version,
  project_membership.membership_version
limit 1
`;

function toAuthorizedContext(
  row: AuthorizationRow,
  input: AuthorizationContextLoadInput,
): AuthorizedContext | null {
  const authzVersion = Number(row.authz_version);
  if (!Number.isSafeInteger(authzVersion) || authzVersion < 0) return null;
  return {
    tenantId: row.tenant_id,
    projectId: row.project_id,
    roles: [...(row.roles ?? [])],
    scopes: [...(row.scopes ?? [])],
    purpose: input.purpose,
    authzVersion,
  };
}

export function createPostgresAuthorizationContextLoader(
  query: AuthorizationQuery,
): AuthorizationContextLoader {
  return async (input) => {
    const result = await query(loadAuthorizationSql, [
      input.actorId,
      input.sessionId,
      input.tenantId,
      input.projectId,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : toAuthorizedContext(row, input);
  };
}
