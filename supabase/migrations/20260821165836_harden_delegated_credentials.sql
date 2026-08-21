alter table platform.delegations
  add column version bigint not null default 1
    constraint delegations_version_check check (version > 0),
  add constraint delegations_revocation_state_check check (
    (status = 'revoked') = (revoked_at is not null)
  ),
  add constraint delegations_revocation_time_check check (
    revoked_at is null or revoked_at >= created_at
  );

alter table platform.delegations
  drop constraint delegations_tenant_id_fkey,
  drop constraint delegations_project_id_tenant_id_fkey,
  add constraint delegations_tenant_id_fkey
    foreign key (tenant_id)
    references platform.tenants(id) on delete restrict,
  add constraint delegations_project_id_tenant_id_fkey
    foreign key (project_id, tenant_id)
    references platform.projects(id, tenant_id) on delete restrict;

alter table platform_private.delegated_credentials
  add column hmac_key_id text not null
    constraint delegated_credentials_hmac_key_id_check check (
      hmac_key_id ~ '^[a-z][a-z0-9_-]{0,95}$'
    ),
  drop constraint delegated_credentials_key_id_check,
  add constraint delegated_credentials_key_id_check check (
    key_id ~ '^wdc_[A-Za-z0-9_-]{22}$'
  ),
  add constraint delegated_credentials_revocation_time_check check (
    revoked_at is null or revoked_at >= created_at
  ),
  add constraint delegated_credentials_rotation_target_check check (
    rotated_to_credential_id is null
      or rotated_to_credential_id <> id
  ),
  add constraint delegated_credentials_rotation_state_check check (
    rotated_to_credential_id is null or revoked_at is not null
  );

alter table platform_private.delegated_credentials
  drop constraint delegated_credentials_delegation_id_fkey,
  add constraint delegated_credentials_delegation_id_fkey
    foreign key (delegation_id)
    references platform.delegations(id) on delete restrict;
