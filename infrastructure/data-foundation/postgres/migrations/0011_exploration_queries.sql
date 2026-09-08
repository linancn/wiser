-- Ephemeral, owner-bound query manifests. Identity remains in Supabase Auth.
create table service.exploration_snapshot (
  query_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  actor_id uuid not null,
  purpose text not null check (length(purpose) between 1 and 256),
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version > 0),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and octet_length(spec::text) <= 131072),
  version_refs jsonb not null check (jsonb_typeof(version_refs) = 'array' and jsonb_array_length(version_refs) <= 10000 and octet_length(version_refs::text) <= 2097152),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);
create index exploration_owner_recent on service.exploration_snapshot
  (tenant_id, project_id, actor_id, created_at desc);
create index exploration_expiry on service.exploration_snapshot (expires_at);
alter table service.exploration_snapshot enable row level security;
alter table service.exploration_snapshot force row level security;
create policy exploration_owner on service.exploration_snapshot
  using (
    security.authorized_row(tenant_id, project_id, security_level, policy_version)
    and actor_id = nullif(current_setting('wiser.actor_id', true), '')::uuid
    and purpose = nullif(current_setting('wiser.purpose', true), '')
    and policy_version = security.current_policy_version()
    and security_level = security.current_max_security_level()
  );
create trigger exploration_manifest_immutable before update on service.exploration_snapshot
  for each row execute function event.reject_append_only_mutation();
revoke all on service.exploration_snapshot from public;
-- Runtime provisioning may run before or after migrations on a fresh database.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'wiser_data_runtime') then
    grant select, insert, delete on service.exploration_snapshot to wiser_data_runtime;
    revoke update on service.exploration_snapshot from wiser_data_runtime;
  end if;
end $$;
