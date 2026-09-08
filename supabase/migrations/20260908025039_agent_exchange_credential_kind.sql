alter table platform_private.delegated_credentials add column credential_kind text not null default 'delegated' check (credential_kind in ('delegated', 'agent_exchange'));
drop index platform_private.delegated_credentials_one_active_idx;
create unique index delegated_credentials_one_active_idx on platform_private.delegated_credentials(delegation_id) where revoked_at is null and credential_kind = 'delegated';

create or replace function platform_private.guard_agent_exchange_credential()
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

