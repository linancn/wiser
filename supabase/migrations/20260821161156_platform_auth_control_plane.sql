create extension if not exists pgcrypto with schema extensions;

create schema platform;
create schema platform_private;

revoke all on schema platform from public, anon, authenticated;
revoke all on schema platform_private from public, anon, authenticated;

create table platform.actors (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null
    check (actor_type in ('human', 'agent', 'service', 'system')),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  authz_version bigint not null default 1 check (authz_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actors_human_auth_user_check check (
    (
      actor_type = 'human'
      and auth_user_id is not null
      and auth_user_id = id
    )
    or (
      actor_type <> 'human'
      and auth_user_id is null
    )
  )
);

create table platform.user_profiles (
  actor_id uuid primary key
    references platform.actors(id) on delete cascade,
  display_name text,
  default_locale text not null default 'zh-CN'
    check (default_locale in ('zh-CN', 'en')),
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  name_zh_cn text not null,
  name_en text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by_actor_id uuid not null
    references platform.actors(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenant_memberships (
  tenant_id uuid not null
    references platform.tenants(id) on delete cascade,
  actor_id uuid not null
    references platform.actors(id) on delete cascade,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  membership_version bigint not null default 1
    check (membership_version > 0),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, actor_id),
  constraint tenant_memberships_expiry_check check (
    expires_at is null or expires_at > effective_at
  )
);

create table platform.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references platform.tenants(id) on delete cascade,
  slug text not null
    check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  name_zh_cn text not null,
  name_en text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by_actor_id uuid not null
    references platform.actors(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (id, tenant_id)
);

create table platform.project_memberships (
  project_id uuid not null,
  tenant_id uuid not null,
  actor_id uuid not null
    references platform.actors(id) on delete cascade,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  membership_version bigint not null default 1
    check (membership_version > 0),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, actor_id),
  unique (project_id, tenant_id, actor_id),
  foreign key (project_id, tenant_id)
    references platform.projects(id, tenant_id) on delete cascade,
  foreign key (tenant_id, actor_id)
    references platform.tenant_memberships(tenant_id, actor_id) on delete cascade,
  constraint project_memberships_expiry_check check (
    expires_at is null or expires_at > effective_at
  )
);

create table platform.roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique
    check (role_key ~ '^[a-z][a-z0-9-]{1,95}$'),
  system_id text not null
    check (system_id in ('platform', 'excon', 'data')),
  status text not null default 'active'
    check (status in ('active', 'retired')),
  created_at timestamptz not null default now()
);

create table platform.role_scopes (
  role_id uuid not null
    references platform.roles(id) on delete cascade,
  scope text not null
    check (
      scope ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
    ),
  created_at timestamptz not null default now(),
  primary key (role_id, scope)
);

create table platform.role_bindings (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null
    references platform.actors(id) on delete cascade,
  tenant_id uuid not null
    references platform.tenants(id) on delete cascade,
  project_id uuid,
  role_id uuid not null
    references platform.roles(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by_actor_id uuid not null
    references platform.actors(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, actor_id)
    references platform.tenant_memberships(tenant_id, actor_id) on delete cascade,
  foreign key (project_id, tenant_id)
    references platform.projects(id, tenant_id) on delete cascade,
  constraint role_bindings_expiry_check check (
    expires_at is null or expires_at > effective_at
  )
);

create table platform.delegations (
  id uuid primary key default gen_random_uuid(),
  delegated_by_actor_id uuid not null
    references platform.actors(id) on delete restrict,
  delegate_actor_id uuid not null
    references platform.actors(id) on delete restrict,
  tenant_id uuid not null
    references platform.tenants(id) on delete cascade,
  project_id uuid not null,
  scopes text[] not null,
  purpose text not null
    check (purpose ~ '^[a-z][a-z0-9-]{0,95}$'),
  max_security_level text not null
    check (
      max_security_level in (
        'L0_PUBLIC',
        'L1_INTERNAL',
        'L2_RESTRICTED',
        'L3_CONFIDENTIAL'
      )
    ),
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id)
    references platform.projects(id, tenant_id) on delete cascade,
  constraint delegations_distinct_actor_check check (
    delegated_by_actor_id <> delegate_actor_id
  ),
  constraint delegations_scope_count_check check (
    cardinality(scopes) between 1 and 128
  ),
  constraint delegations_scope_format_check check (
    array_to_string(scopes, ',')
      ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+(,[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+)*$'
  ),
  constraint delegations_expiry_check check (expires_at > created_at)
);

create table platform_private.delegated_credentials (
  id uuid primary key default gen_random_uuid(),
  delegation_id uuid not null
    references platform.delegations(id) on delete cascade,
  key_id text not null unique
    check (key_id ~ '^wdc_[A-Za-z0-9_-]{8,96}$'),
  token_hmac bytea not null unique
    check (octet_length(token_hmac) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_to_credential_id uuid
    references platform_private.delegated_credentials(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint delegated_credentials_expiry_check check (
    expires_at > created_at
  )
);

create table platform_private.authorization_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references platform.actors(id) on delete set null,
  tenant_id uuid references platform.tenants(id) on delete restrict,
  project_id uuid,
  capability text not null,
  purpose text,
  decision text not null check (decision in ('allowed', 'denied')),
  reason_code text not null,
  resource_type text,
  resource_id text,
  security_level text,
  authz_version bigint,
  trace_id text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id)
    references platform.projects(id, tenant_id) on delete restrict
);

create table platform_private.control_outbox (
  id bigint generated always as identity primary key,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text,
  created_at timestamptz not null default now()
);

create index tenants_created_by_actor_idx
  on platform.tenants (created_by_actor_id);
create index tenant_memberships_actor_status_idx
  on platform.tenant_memberships (actor_id, status, tenant_id);
create index projects_created_by_actor_idx
  on platform.projects (created_by_actor_id);
create index project_memberships_project_tenant_actor_idx
  on platform.project_memberships (project_id, tenant_id, actor_id);
create index project_memberships_tenant_actor_idx
  on platform.project_memberships (tenant_id, actor_id);
create index project_memberships_actor_status_idx
  on platform.project_memberships (actor_id, status, project_id);
create index role_bindings_actor_status_idx
  on platform.role_bindings (actor_id, status, tenant_id, project_id);
create index role_bindings_tenant_actor_idx
  on platform.role_bindings (tenant_id, actor_id);
create index role_bindings_project_tenant_idx
  on platform.role_bindings (project_id, tenant_id)
  where project_id is not null;
create index role_bindings_role_idx
  on platform.role_bindings (role_id);
create index role_bindings_created_by_actor_idx
  on platform.role_bindings (created_by_actor_id);
create index delegations_delegated_by_actor_idx
  on platform.delegations (delegated_by_actor_id, status, expires_at);
create index delegations_delegate_actor_idx
  on platform.delegations (delegate_actor_id, status, expires_at);
create index delegations_tenant_idx
  on platform.delegations (tenant_id);
create index delegations_project_tenant_idx
  on platform.delegations (project_id, tenant_id);
create unique index delegated_credentials_one_active_idx
  on platform_private.delegated_credentials (delegation_id)
  where revoked_at is null;
create index delegated_credentials_rotated_to_idx
  on platform_private.delegated_credentials (rotated_to_credential_id)
  where rotated_to_credential_id is not null;
create index authorization_audit_actor_created_idx
  on platform_private.authorization_audit_events (actor_id, created_at desc);
create index authorization_audit_tenant_created_idx
  on platform_private.authorization_audit_events (tenant_id, created_at desc);
create index authorization_audit_project_tenant_idx
  on platform_private.authorization_audit_events (project_id, tenant_id)
  where project_id is not null;
create index control_outbox_claim_idx
  on platform_private.control_outbox (available_at, id)
  where published_at is null;

create function platform_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into platform.actors (
    id,
    actor_type,
    auth_user_id,
    status
  ) values (
    new.id,
    'human',
    new.id,
    'active'
  )
  on conflict (id) do nothing;

  insert into platform.user_profiles (
    actor_id,
    display_name,
    default_locale,
    timezone
  ) values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    case
      when new.raw_user_meta_data ->> 'locale' in ('zh-CN', 'en')
        then new.raw_user_meta_data ->> 'locale'
      else 'zh-CN'
    end,
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'Asia/Shanghai')
  )
  on conflict (actor_id) do nothing;

  return new;
end;
$$;

revoke all on function platform_private.handle_new_auth_user()
  from public, anon, authenticated, service_role;

create trigger wiser_auth_user_provisioning
after insert on auth.users
for each row execute function platform_private.handle_new_auth_user();

insert into platform.actors (
  id,
  actor_type,
  auth_user_id,
  status
)
select
  auth_user.id,
  'human',
  auth_user.id,
  'active'
from auth.users as auth_user
on conflict (id) do nothing;

insert into platform.user_profiles (
  actor_id,
  display_name,
  default_locale,
  timezone
)
select
  auth_user.id,
  nullif(auth_user.raw_user_meta_data ->> 'display_name', ''),
  case
    when auth_user.raw_user_meta_data ->> 'locale' in ('zh-CN', 'en')
      then auth_user.raw_user_meta_data ->> 'locale'
    else 'zh-CN'
  end,
  coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'timezone', ''),
    'Asia/Shanghai'
  )
from auth.users as auth_user
on conflict (actor_id) do nothing;

alter table platform.actors enable row level security;
alter table platform.actors force row level security;
alter table platform.user_profiles enable row level security;
alter table platform.user_profiles force row level security;
alter table platform.tenants enable row level security;
alter table platform.tenants force row level security;
alter table platform.tenant_memberships enable row level security;
alter table platform.tenant_memberships force row level security;
alter table platform.projects enable row level security;
alter table platform.projects force row level security;
alter table platform.project_memberships enable row level security;
alter table platform.project_memberships force row level security;
alter table platform.roles enable row level security;
alter table platform.roles force row level security;
alter table platform.role_scopes enable row level security;
alter table platform.role_scopes force row level security;
alter table platform.role_bindings enable row level security;
alter table platform.role_bindings force row level security;
alter table platform.delegations enable row level security;
alter table platform.delegations force row level security;
alter table platform_private.delegated_credentials enable row level security;
alter table platform_private.delegated_credentials force row level security;
alter table platform_private.authorization_audit_events enable row level security;
alter table platform_private.authorization_audit_events force row level security;
alter table platform_private.control_outbox enable row level security;
alter table platform_private.control_outbox force row level security;

revoke all on all tables in schema platform from public, anon, authenticated;
revoke all on all sequences in schema platform from public, anon, authenticated;
revoke all on all functions in schema platform from public, anon, authenticated;
revoke all on all tables in schema platform_private from public, anon, authenticated;
revoke all on all sequences in schema platform_private from public, anon, authenticated;
revoke all on all functions in schema platform_private from public, anon, authenticated;

alter default privileges in schema platform
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema platform
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema platform
  revoke all on functions from public, anon, authenticated;
alter default privileges in schema platform_private
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema platform_private
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema platform_private
  revoke all on functions from public, anon, authenticated;
