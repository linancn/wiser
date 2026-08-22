set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'wiser_excon_runtime'
  ) then
    create role wiser_excon_runtime
      with nosuperuser nocreatedb nocreaterole noinherit nobypassrls nologin;
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'wiser_excon_api'
  ) then
    create role wiser_excon_api
      with nosuperuser nocreatedb nocreaterole inherit nobypassrls login;
  end if;
  if exists (
    select 1
    from pg_roles
    where rolname in ('wiser_excon_runtime', 'wiser_excon_api')
      and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)
  ) then
    raise exception 'Agent EXCON runtime roles must remain unprivileged';
  end if;
end;
$$;

alter role wiser_excon_runtime
  with noinherit nologin;
alter role wiser_excon_api
  with inherit login;
grant wiser_excon_runtime to wiser_excon_api;

create table excon_private.v2_command_intents (
  intent_seq bigint generated always as identity primary key,
  intent_id uuid not null unique,
  command_name text not null check (command_name in (
    'createScenario',
    'createScenarioVersion',
    'validateScenarioVersion',
    'publishScenarioVersion',
    'createAgent',
    'createAgentVersion',
    'createRun',
    'joinRun',
    'startRun',
    'sync',
    'claimTask',
    'beginTask',
    'heartbeatTask',
    'releaseTask',
    'submitTask',
    'createMessage',
    'createArtifact',
    'createArtifactVersion',
    'endorseSubmission'
  )),
  journal_version smallint not null default 1 check (journal_version = 1),
  request_hash text not null check (
    request_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  principal jsonb not null check (jsonb_typeof(principal) = 'object'),
  arguments jsonb not null check (jsonb_typeof(arguments) = 'array'),
  lease_key_id text not null check (
    lease_key_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  constraint v2_command_intents_lease_reference_shape check (
    command_name not in (
      'beginTask', 'heartbeatTask', 'releaseTask', 'submitTask'
    ) or case
      when jsonb_typeof(arguments #> '{3,leaseToken}') = 'object'
        and jsonb_typeof(
          arguments #> '{3,leaseToken,$secretRef}'
        ) = 'object'
      then arguments #> '{3,leaseToken}' = jsonb_build_object(
          '$secretRef',
          arguments #> '{3,leaseToken,$secretRef}'
        )
        and arguments #> '{3,leaseToken,$secretRef}' = jsonb_build_object(
          'kind',
          'lease-token-hash',
          'tokenHash',
          arguments #>> '{3,leaseToken,$secretRef,tokenHash}'
        )
        and arguments #>> '{3,leaseToken,$secretRef,kind}' =
          'lease-token-hash'
        and arguments #>> '{3,leaseToken,$secretRef,tokenHash}' ~
          '^sha256:[0-9a-f]{64}$'
      else false
    end
  )
);

create table excon_private.v2_command_outcomes (
  outcome_seq bigint generated always as identity primary key,
  intent_id uuid not null unique
    references excon_private.v2_command_intents(intent_id) on delete restrict,
  outcome_status text not null check (
    outcome_status in ('succeeded', 'rejected')
  ),
  result_hash text not null check (
    result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  error_code text check (
    error_code is null or (
      length(error_code) between 1 and 128
      and error_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  generated_ids jsonb not null check (jsonb_typeof(generated_ids) = 'array'),
  generated_timestamps jsonb not null check (
    jsonb_typeof(generated_timestamps) = 'array'
  ),
  lease_counter_count integer not null check (
    lease_counter_count between 0 and 100000
  ),
  created_at timestamptz not null default clock_timestamp(),
  constraint v2_command_outcomes_status_shape check (
    (outcome_status = 'succeeded' and error_code is null)
    or (outcome_status = 'rejected' and error_code is not null)
  )
);

create or replace function excon_private.reject_v2_journal_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'v2 command journal facts are append-only'
    using errcode = '55000';
end;
$$;

create trigger v2_command_intents_append_only
before update or delete on excon_private.v2_command_intents
for each row execute function excon_private.reject_v2_journal_mutation();

create trigger v2_command_outcomes_append_only
before update or delete on excon_private.v2_command_outcomes
for each row execute function excon_private.reject_v2_journal_mutation();

alter table excon_private.v2_command_intents enable row level security;
alter table excon_private.v2_command_intents force row level security;
alter table excon_private.v2_command_outcomes enable row level security;
alter table excon_private.v2_command_outcomes force row level security;

create policy v2_command_intents_runtime_read
on excon_private.v2_command_intents
for select to wiser_excon_runtime
using (true);

create policy v2_command_intents_runtime_append
on excon_private.v2_command_intents
for insert to wiser_excon_runtime
with check (true);

create policy v2_command_outcomes_runtime_read
on excon_private.v2_command_outcomes
for select to wiser_excon_runtime
using (true);

create policy v2_command_outcomes_runtime_append
on excon_private.v2_command_outcomes
for insert to wiser_excon_runtime
with check (true);

revoke all on table excon_private.v2_command_intents
  from public, anon, authenticated, service_role;
revoke all on table excon_private.v2_command_outcomes
  from public, anon, authenticated, service_role;
revoke all on sequence excon_private.v2_command_intents_intent_seq_seq
  from public, anon, authenticated, service_role;
revoke all on sequence excon_private.v2_command_outcomes_outcome_seq_seq
  from public, anon, authenticated, service_role;
revoke all on function excon_private.reject_v2_journal_mutation()
  from public, anon, authenticated, service_role;

grant usage on schema excon_private to wiser_excon_runtime;
grant select, insert on table excon_private.v2_command_intents
  to wiser_excon_runtime;
grant select, insert on table excon_private.v2_command_outcomes
  to wiser_excon_runtime;
grant usage on sequence excon_private.v2_command_intents_intent_seq_seq
  to wiser_excon_runtime;
grant usage on sequence excon_private.v2_command_outcomes_outcome_seq_seq
  to wiser_excon_runtime;
revoke update, delete, truncate on table excon_private.v2_command_intents
  from wiser_excon_runtime, wiser_excon_api;
revoke update, delete, truncate on table excon_private.v2_command_outcomes
  from wiser_excon_runtime, wiser_excon_api;
