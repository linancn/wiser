create table platform_private.agent_connections (
  id uuid primary key default gen_random_uuid(),
  owner_actor_id uuid not null references platform.actors(id) on delete restrict,
  oauth_client_id uuid not null,
  delegation_id uuid not null unique references platform.delegations(id) on delete restrict,
  resource text not null check (
    length(resource) <= 2048
    and resource ~ '^https?://[^/?#@]+/mcp$'
    and (resource like 'https://%' or resource ~ '^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/mcp$')
  ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (owner_actor_id, oauth_client_id)
);

create table platform_private.agent_exchange_credentials (
  credential_id uuid primary key references platform_private.delegated_credentials(id) on delete restrict,
  connection_id uuid not null references platform_private.agent_connections(id) on delete restrict,
  oauth_session_id uuid not null,
  oauth_token_expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  check (oauth_token_expires_at > created_at)
);

create index agent_connections_owner_idx on platform_private.agent_connections(owner_actor_id);
create index agent_exchange_connections_idx on platform_private.agent_exchange_credentials(connection_id);
create index agent_exchange_sessions_idx on platform_private.agent_exchange_credentials(oauth_session_id);

alter table platform_private.agent_connections enable row level security;
alter table platform_private.agent_connections force row level security;
alter table platform_private.agent_exchange_credentials enable row level security;
alter table platform_private.agent_exchange_credentials force row level security;
revoke all on platform_private.agent_connections from public, anon, authenticated;
revoke all on platform_private.agent_exchange_credentials from public, anon, authenticated;

create function platform_private.guard_agent_connection()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.owner_actor_id <> old.owner_actor_id
    or new.oauth_client_id <> old.oauth_client_id
    or new.created_at <> old.created_at or new.version <> old.version + 1
  ) then
    raise exception using errcode = '23514', message = 'AGENT_CONNECTION_VERSION_OR_IDENTITY_INVALID';
  end if;
  if not exists (
    select 1 from platform.delegations d
    join platform.actors a on a.id = d.delegated_by_actor_id
    where d.id = new.delegation_id and d.delegated_by_actor_id = new.owner_actor_id
      and a.actor_type = 'human' and d.purpose = 'agent-data'
  ) then
    raise exception using errcode = '23514', message = 'AGENT_CONNECTION_DELEGATION_INVALID';
  end if;
  return new;
end;
$$;

create trigger guard_agent_connection before insert or update
on platform_private.agent_connections for each row
execute function platform_private.guard_agent_connection();

create function platform_private.guard_agent_exchange_credential()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '23514', message = 'AGENT_EXCHANGE_BINDING_IMMUTABLE';
  end if;
  if not exists (
    select 1 from platform_private.agent_connections c
    join platform_private.delegated_credentials credential
      on credential.delegation_id = c.delegation_id
    join auth.sessions session on session.id = new.oauth_session_id
      and session.user_id = c.owner_actor_id and session.oauth_client_id = c.oauth_client_id
    where c.id = new.connection_id and credential.id = new.credential_id
      and credential.credential_kind = 'agent_exchange'
      and credential.expires_at <= new.oauth_token_expires_at
  ) then
    raise exception using errcode = '23514', message = 'AGENT_EXCHANGE_BINDING_INVALID';
  end if;
  return new;
end;
$$;

create trigger guard_agent_exchange_credential before insert or update or delete
on platform_private.agent_exchange_credentials for each row
execute function platform_private.guard_agent_exchange_credential();

create function platform_private.guard_credential_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.credential_kind is distinct from old.credential_kind then
    raise exception using errcode = '23514', message = 'CREDENTIAL_KIND_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger guard_credential_kind before update on platform_private.delegated_credentials
for each row execute function platform_private.guard_credential_kind();
revoke all on function platform_private.guard_credential_kind() from public, anon, authenticated;

create function platform_private.require_agent_exchange_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.credential_kind = 'agent_exchange' and not exists (
    select 1 from platform_private.agent_exchange_credentials e where e.credential_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'AGENT_EXCHANGE_BINDING_REQUIRED';
  end if;
  return new;
end;
$$;
create constraint trigger require_agent_exchange_binding
after insert on platform_private.delegated_credentials deferrable initially deferred
for each row execute function platform_private.require_agent_exchange_binding();
revoke all on function platform_private.require_agent_exchange_binding() from public, anon, authenticated;

create function platform_private.agent_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  claims jsonb := event -> 'claims';
  connection record;
begin
  if not (claims ? 'client_id') then
    return event;
  end if;
  select c.resource, c.delegation_id into connection
  from platform_private.agent_connections c
  join platform.delegations d on d.id = c.delegation_id
  where c.owner_actor_id::text = event ->> 'user_id'
    and c.owner_actor_id::text = claims ->> 'sub'
    and c.oauth_client_id::text = claims ->> 'client_id'
    and d.status = 'active' and d.revoked_at is null
    and d.expires_at > statement_timestamp();
  if not found then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Agent access is not authorized.'
    ));
  end if;
  claims := jsonb_set(claims, '{aud}', to_jsonb(connection.resource));
  claims := jsonb_set(claims, '{wiser_delegation_id}', to_jsonb(connection.delegation_id::text));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke all on function platform_private.guard_agent_connection() from public, anon, authenticated;
revoke all on function platform_private.guard_agent_exchange_credential() from public, anon, authenticated;
revoke all on function platform_private.agent_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema platform, platform_private to supabase_auth_admin;
grant select on platform_private.agent_connections, platform.delegations to supabase_auth_admin;
create policy agent_connections_auth_hook on platform_private.agent_connections
for select to supabase_auth_admin using (true);
create policy delegations_auth_hook on platform.delegations
for select to supabase_auth_admin using (true);
grant execute on function platform_private.agent_access_token_hook(jsonb) to supabase_auth_admin;

-- The OAuth resource token is exchanged at the WISER API. It must never inherit
-- ordinary authenticated access through the separately exposed Supabase Data API.
do $$
declare relation record;
begin
  for relation in
    select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format(
      'create policy wiser_direct_session_only on %I.%I as restrictive for all to authenticated using (((select auth.jwt()) ->> ''client_id'') is null) with check (((select auth.jwt()) ->> ''client_id'') is null)',
      relation.nspname, relation.relname
    );
  end loop;
end;
$$;
