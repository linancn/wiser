-- Durable, revocable display configurations; Supabase remains the identity authority.
create table service.exploration_saved_view (
  view_id uuid primary key,
  query_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  actor_id uuid not null,
  purpose text not null check (length(purpose) between 1 and 256),
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version > 0),
  title text not null check (length(btrim(title)) between 1 and 160),
  visibility text not null check (visibility in ('private','project')),
  spec jsonb not null check (jsonb_typeof(spec)='object' and octet_length(spec::text)<=131072),
  version_refs jsonb not null check (jsonb_typeof(version_refs)='array' and jsonb_array_length(version_refs)<=10000 and octet_length(version_refs::text)<=2097152),
  view_spec jsonb not null check (jsonb_typeof(view_spec)='object' and octet_length(view_spec::text)<=131072),
  created_at timestamptz not null,
  revoked_at timestamptz check (revoked_at>=created_at)
);
create index exploration_saved_owner on service.exploration_saved_view(tenant_id,project_id,actor_id,created_at desc,view_id) where revoked_at is null;
alter table service.exploration_saved_view enable row level security;
alter table service.exploration_saved_view force row level security;
create policy exploration_saved_read on service.exploration_saved_view for select using (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and purpose=nullif(current_setting('wiser.purpose',true),'')
  and (actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid or (visibility='project' and revoked_at is null))
);
create policy exploration_saved_create on service.exploration_saved_view for insert with check (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid
  and purpose=nullif(current_setting('wiser.purpose',true),'')
  and revoked_at is null
);
create policy exploration_saved_revoke on service.exploration_saved_view for update using (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid
  and purpose=nullif(current_setting('wiser.purpose',true),'')
) with check (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid
  and purpose=nullif(current_setting('wiser.purpose',true),'')
);
create function service.guard_exploration_saved_view() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or new.revoked_at is null
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Saved view configuration is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger exploration_saved_immutable before update on service.exploration_saved_view for each row execute function service.guard_exploration_saved_view();
revoke all on service.exploration_saved_view from public;
revoke all on function service.guard_exploration_saved_view() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
    grant select,insert on service.exploration_saved_view to wiser_data_runtime;
    revoke update,delete on service.exploration_saved_view from wiser_data_runtime;
    grant update(revoked_at) on service.exploration_saved_view to wiser_data_runtime;
  end if;
end $$;
