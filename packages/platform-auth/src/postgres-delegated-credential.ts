import type { DelegatedCredentialAuthorizationRecord } from './delegated-credential-principal-resolver.js';

export interface DelegatedCredentialAuthorizationRow {
  readonly credential_id: string;
  readonly delegation_id: string;
  readonly key_id: string;
  readonly hmac_key_id: string;
  readonly token_hmac: Uint8Array;
  readonly credential_expires_at: Date | string;
  readonly credential_revoked_at: Date | string | null;
  readonly rotated_to_credential_id: string | null;
  readonly delegated_by_actor_id: string;
  readonly delegated_by_actor_status: string;
  readonly delegate_actor_id: string;
  readonly delegate_actor_type: string;
  readonly delegate_actor_status: string;
  readonly tenant_id: string;
  readonly tenant_status: string;
  readonly project_id: string;
  readonly project_status: string;
  readonly purpose: string;
  readonly delegation_scopes: readonly string[] | null;
  readonly delegation_max_security_level: string;
  readonly delegation_status: string;
  readonly delegation_expires_at: Date | string;
  readonly delegation_revoked_at: Date | string | null;
  readonly delegator_scopes: readonly string[] | null;
  readonly delegator_max_security_level: string;
  readonly delegator_tenant_membership_active: boolean | null;
  readonly delegator_project_membership_active: boolean | null;
  readonly delegate_tenant_membership_active: boolean | null;
  readonly delegate_project_membership_active: boolean | null;
  readonly authz_version: number | string;
}

export type DelegatedCredentialAuthorizationQuery = (
  text: string,
  values: readonly unknown[],
) => Promise<{
  readonly rows: readonly DelegatedCredentialAuthorizationRow[];
}>;

const LOAD_DELEGATED_CREDENTIAL_SQL = `
select
  credential.id as credential_id,
  credential.delegation_id,
  credential.key_id,
  credential.hmac_key_id,
  credential.token_hmac,
  credential.expires_at as credential_expires_at,
  credential.revoked_at as credential_revoked_at,
  credential.rotated_to_credential_id,
  delegation.delegated_by_actor_id,
  delegator.status as delegated_by_actor_status,
  delegation.delegate_actor_id,
  delegate.actor_type as delegate_actor_type,
  delegate.status as delegate_actor_status,
  delegation.tenant_id,
  tenant.status as tenant_status,
  delegation.project_id,
  project.status as project_status,
  delegation.purpose,
  delegation.scopes as delegation_scopes,
  delegation.max_security_level as delegation_max_security_level,
  delegation.status as delegation_status,
  delegation.expires_at as delegation_expires_at,
  delegation.revoked_at as delegation_revoked_at,
  coalesce(
    array(
      select distinct role_scope.scope
      from platform.role_bindings as binding
      join platform.roles as role
        on role.id = binding.role_id
       and role.status = 'active'
      join platform.role_scopes as role_scope
        on role_scope.role_id = role.id
      where binding.actor_id = delegation.delegated_by_actor_id
        and binding.tenant_id = delegation.tenant_id
        and (binding.project_id is null or binding.project_id = delegation.project_id)
        and binding.status = 'active'
        and binding.effective_at <= statement_timestamp()
        and (binding.expires_at is null or binding.expires_at > statement_timestamp())
      order by role_scope.scope
    ),
    array[]::text[]
  ) as delegator_scopes,
  coalesce(
    (
      select case max(
        case role.max_security_level
          when 'L0_PUBLIC' then 0
          when 'L1_INTERNAL' then 1
          when 'L2_RESTRICTED' then 2
          when 'L3_CONFIDENTIAL' then 3
        end
      )
        when 0 then 'L0_PUBLIC'
        when 1 then 'L1_INTERNAL'
        when 2 then 'L2_RESTRICTED'
        when 3 then 'L3_CONFIDENTIAL'
      end
      from platform.role_bindings as binding
      join platform.roles as role
        on role.id = binding.role_id
       and role.status = 'active'
      where binding.actor_id = delegation.delegated_by_actor_id
        and binding.tenant_id = delegation.tenant_id
        and (binding.project_id is null or binding.project_id = delegation.project_id)
        and binding.status = 'active'
        and binding.effective_at <= statement_timestamp()
        and (binding.expires_at is null or binding.expires_at > statement_timestamp())
    ),
    'L0_PUBLIC'
  ) as delegator_max_security_level,
  exists (
    select 1
    from platform.tenant_memberships as membership
    where membership.tenant_id = delegation.tenant_id
      and membership.actor_id = delegation.delegated_by_actor_id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as delegator_tenant_membership_active,
  exists (
    select 1
    from platform.project_memberships as membership
    where membership.tenant_id = delegation.tenant_id
      and membership.project_id = delegation.project_id
      and membership.actor_id = delegation.delegated_by_actor_id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as delegator_project_membership_active,
  exists (
    select 1
    from platform.tenant_memberships as membership
    where membership.tenant_id = delegation.tenant_id
      and membership.actor_id = delegation.delegate_actor_id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as delegate_tenant_membership_active,
  exists (
    select 1
    from platform.project_memberships as membership
    where membership.tenant_id = delegation.tenant_id
      and membership.project_id = delegation.project_id
      and membership.actor_id = delegation.delegate_actor_id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as delegate_project_membership_active,
  greatest(
    delegator.authz_version,
    delegate.authz_version,
    tenant.version,
    project.version,
    delegation.version,
    coalesce((
      select membership.membership_version
      from platform.tenant_memberships as membership
      where membership.tenant_id = delegation.tenant_id
        and membership.actor_id = delegation.delegated_by_actor_id
    ), 0),
    coalesce((
      select membership.membership_version
      from platform.project_memberships as membership
      where membership.project_id = delegation.project_id
        and membership.actor_id = delegation.delegated_by_actor_id
    ), 0),
    coalesce((
      select membership.membership_version
      from platform.tenant_memberships as membership
      where membership.tenant_id = delegation.tenant_id
        and membership.actor_id = delegation.delegate_actor_id
    ), 0),
    coalesce((
      select membership.membership_version
      from platform.project_memberships as membership
      where membership.project_id = delegation.project_id
        and membership.actor_id = delegation.delegate_actor_id
    ), 0)
  ) as authz_version
from platform_private.delegated_credentials as credential
join platform.delegations as delegation
  on delegation.id = credential.delegation_id
join platform.actors as delegator
  on delegator.id = delegation.delegated_by_actor_id
join platform.actors as delegate
  on delegate.id = delegation.delegate_actor_id
join platform.tenants as tenant
  on tenant.id = delegation.tenant_id
join platform.projects as project
  on project.id = delegation.project_id
 and project.tenant_id = delegation.tenant_id
where credential.key_id = $1
limit 1
`;

function isoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function nullableTimestamp(value: Date | string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function toRecord(
  row: DelegatedCredentialAuthorizationRow,
): DelegatedCredentialAuthorizationRecord {
  return {
    credentialId: row.credential_id,
    delegationId: row.delegation_id,
    keyId: row.key_id,
    hmacKeyId: row.hmac_key_id,
    tokenHmac: row.token_hmac,
    credentialExpiresAt: isoTimestamp(row.credential_expires_at),
    credentialRevokedAt: nullableTimestamp(row.credential_revoked_at),
    rotatedToCredentialId: row.rotated_to_credential_id,
    delegatedByActorId: row.delegated_by_actor_id,
    delegatedByActorStatus: row.delegated_by_actor_status,
    delegateActorId: row.delegate_actor_id,
    delegateActorType: row.delegate_actor_type,
    delegateActorStatus: row.delegate_actor_status,
    tenantId: row.tenant_id,
    tenantStatus: row.tenant_status,
    projectId: row.project_id,
    projectStatus: row.project_status,
    purpose: row.purpose,
    delegationScopes: [...(row.delegation_scopes ?? [])],
    delegationMaxSecurityLevel: row.delegation_max_security_level,
    delegationStatus: row.delegation_status,
    delegationExpiresAt: isoTimestamp(row.delegation_expires_at),
    delegationRevokedAt: nullableTimestamp(row.delegation_revoked_at),
    delegatorScopes: [...(row.delegator_scopes ?? [])],
    delegatorMaxSecurityLevel: row.delegator_max_security_level,
    delegatorTenantMembershipActive:
      row.delegator_tenant_membership_active === true,
    delegatorProjectMembershipActive:
      row.delegator_project_membership_active === true,
    delegateTenantMembershipActive:
      row.delegate_tenant_membership_active === true,
    delegateProjectMembershipActive:
      row.delegate_project_membership_active === true,
    authzVersion: row.authz_version,
  };
}

export function createPostgresDelegatedCredentialRecordLoader(
  query: DelegatedCredentialAuthorizationQuery,
) {
  return async (keyId: string) => {
    const result = await query(LOAD_DELEGATED_CREDENTIAL_SQL, [keyId]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  };
}
