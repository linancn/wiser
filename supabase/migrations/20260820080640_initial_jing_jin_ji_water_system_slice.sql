create schema if not exists excon_private;

revoke all on schema excon_private from public, anon, authenticated, service_role;

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  title_i18n jsonb not null
    check (
      jsonb_typeof(title_i18n) = 'object'
      and title_i18n ?& array['zh-CN', 'en']
    ),
  description_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(description_i18n) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.scenario_versions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'published', 'retired')),
  public_manifest jsonb not null
    check (jsonb_typeof(public_manifest) = 'object'),
  replay_start_at timestamptz not null,
  replay_end_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (scenario_id, version_no),
  unique (scenario_id, content_hash),
  check (replay_start_at < replay_end_at),
  check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'retired') and published_at is not null)
  )
);

create table public.participant_versions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  agent_key text not null check (length(agent_key) between 1 and 128),
  version text not null check (length(version) between 1 and 64),
  model_ref text,
  skill_version text,
  workflow_version text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_user_id, agent_key, version)
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  participant_version_id uuid not null
    references public.participant_versions(id) on delete restrict,
  mode text not null default 'historical_replay'
    check (mode = 'historical_replay'),
  state text not null check (state in (
    'created',
    'initialized',
    'running',
    'waiting_for_submission',
    'evaluation_queued',
    'evaluating',
    'feedback_available',
    'final_submitted',
    'waiting_for_outcome',
    'completed',
    'paused',
    'cancelled',
    'failed'
  )),
  virtual_time timestamptz not null,
  lock_version bigint not null default 0 check (lock_version >= 0),
  last_event_seq bigint not null default 0 check (last_event_seq >= 0),
  last_event_hash bytea,
  parent_episode_id uuid references public.episodes(id) on delete restrict,
  fork_event_seq bigint check (fork_event_seq is null or fork_event_seq > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (parent_episode_id is null and fork_event_seq is null)
    or (parent_episode_id is not null and fork_event_seq is not null)
  ),
  check ((state = 'completed') = (completed_at is not null)),
  check (last_event_hash is null or octet_length(last_event_hash) = 32)
);

create table public.episode_members (
  episode_id uuid not null references public.episodes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  participant_version_id uuid not null
    references public.participant_versions(id) on delete restrict,
  member_role text not null
    check (member_role in ('participant', 'operator', 'reviewer')),
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id),
  unique (episode_id, user_id, participant_version_id)
);

create table excon_private.information_items (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  supersedes_item_id uuid
    references excon_private.information_items(id) on delete restrict,
  batch_key text not null check (length(batch_key) between 1 and 128),
  system_component text not null
    check (length(system_component) between 1 and 128),
  information_type text not null
    check (length(information_type) between 1 and 128),
  is_synthetic boolean not null,
  source_ref text not null check (length(source_ref) between 1 and 256),
  source_url text,
  event_time timestamptz not null,
  observed_time timestamptz not null,
  ingested_time timestamptz not null,
  release_virtual_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (scenario_version_id, payload_hash),
  check (
    event_time <= observed_time
    and observed_time <= ingested_time
    and ingested_time <= release_virtual_at
  ),
  check (is_synthetic or source_url is not null)
);

create table excon_private.injects (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete restrict,
  information_item_id uuid not null
    references excon_private.information_items(id) on delete restrict,
  state text not null check (state in ('pending', 'released')),
  planned_release_virtual_at timestamptz not null,
  released_virtual_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (episode_id, information_item_id),
  unique (id, episode_id),
  check (
    (state = 'pending' and released_virtual_at is null and released_at is null)
    or
    (
      state = 'released'
      and released_virtual_at is not null
      and released_at is not null
      and released_virtual_at >= planned_release_virtual_at
    )
  )
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  inject_id uuid not null,
  recipient_user_id uuid not null,
  released_virtual_at timestamptz not null,
  accessed_virtual_at timestamptz not null,
  accessed_at timestamptz not null default now(),
  payload_snapshot jsonb not null
    check (jsonb_typeof(payload_snapshot) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  unique (episode_id, inject_id, recipient_user_id),
  foreign key (inject_id, episode_id)
    references excon_private.injects(id, episode_id) on delete restrict,
  foreign key (episode_id, recipient_user_id)
    references public.episode_members(episode_id, user_id) on delete restrict,
  check (released_virtual_at <= accessed_virtual_at)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  participant_version_id uuid not null,
  actor_user_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  revision_of uuid references public.submissions(id) on delete restrict,
  submission_type text not null check (submission_type = 'allocation_plan'),
  is_final boolean not null default false,
  submitted_virtual_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null
    check (length(idempotency_key) between 8 and 128),
  unique (episode_id, revision_no),
  unique (episode_id, actor_user_id, idempotency_key),
  unique (id, episode_id, actor_user_id),
  foreign key (episode_id, actor_user_id, participant_version_id)
    references public.episode_members(
      episode_id,
      user_id,
      participant_version_id
    ) on delete restrict
);

create unique index submissions_one_final_idx
  on public.submissions (episode_id)
  where is_final;

create table public.allocation_plans (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  episode_id uuid not null,
  actor_user_id uuid not null,
  plan_start_at timestamptz not null,
  plan_end_at timestamptz not null,
  total_volume_m3 numeric(18,3) not null check (total_volume_m3 > 0),
  constraints_version text not null
    check (length(constraints_version) between 1 and 64),
  summary_i18n jsonb not null
    check (
      jsonb_typeof(summary_i18n) = 'object'
      and summary_i18n ?& array['zh-CN', 'en']
    ),
  created_at timestamptz not null default now(),
  unique (id, actor_user_id),
  unique (submission_id, episode_id, actor_user_id),
  foreign key (submission_id, episode_id, actor_user_id)
    references public.submissions(id, episode_id, actor_user_id)
    on delete restrict,
  check (plan_start_at < plan_end_at)
);

create table public.allocation_items (
  id uuid primary key default gen_random_uuid(),
  allocation_plan_id uuid not null,
  actor_user_id uuid not null,
  source_code text not null check (length(source_code) between 1 and 128),
  target_code text not null check (length(target_code) between 1 and 128),
  water_source_type text not null check (water_source_type in (
    'yellow_river_diversion',
    'south_north_diversion',
    'reservoir_release',
    'reclaimed_water',
    'local_surface_water'
  )),
  purpose text not null check (purpose in (
    'ecological_replenishment',
    'urban_supply',
    'agriculture',
    'emergency_reserve'
  )),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  volume_m3 numeric(18,3) not null check (volume_m3 > 0),
  max_flow_m3_s numeric(12,3) not null check (max_flow_m3_s > 0),
  priority smallint not null default 100 check (priority between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (allocation_plan_id, actor_user_id)
    references public.allocation_plans(id, actor_user_id) on delete restrict,
  unique (allocation_plan_id, source_code, target_code, starts_at),
  check (source_code <> target_code),
  check (starts_at < ends_at)
);

create table excon_private.water_system_outcomes (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  checkpoint_key text not null check (length(checkpoint_key) between 1 and 128),
  system_component text not null
    check (length(system_component) between 1 and 128),
  metric_code text not null check (length(metric_code) between 1 and 128),
  metric_value numeric(20,6) not null,
  unit text not null check (length(unit) between 1 and 32),
  observed_at timestamptz not null,
  ingested_at timestamptz not null,
  source_ref text not null,
  is_synthetic boolean not null default true,
  outcome_version text not null check (length(outcome_version) between 1 and 64),
  fact_hash text not null check (fact_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (
    scenario_version_id,
    checkpoint_key,
    system_component,
    metric_code,
    outcome_version
  ),
  check (observed_at <= ingested_at)
);

create table excon_private.evaluation_jobs (
  id bigint generated always as identity primary key,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  job_type text not null check (job_type = 'allocation_constraint_evaluation'),
  dedupe_key text not null check (length(dedupe_key) between 1 and 256),
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'succeeded', 'failed', 'dead'
  )),
  priority smallint not null default 0,
  run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type, dedupe_key),
  check (attempts <= max_attempts),
  check (
    status <> 'pending'
    or (locked_by is null and locked_at is null and lease_expires_at is null)
  ),
  check (
    status <> 'processing'
    or (locked_by is not null and locked_at is not null and lease_expires_at is not null)
  )
);

create table excon_private.evaluations (
  id uuid primary key default gen_random_uuid(),
  job_id bigint not null unique
    references excon_private.evaluation_jobs(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  evaluator_key text not null check (length(evaluator_key) between 1 and 128),
  evaluator_version text not null check (length(evaluator_version) between 1 and 64),
  rules_version text not null check (length(rules_version) between 1 and 64),
  outcome_version text not null check (length(outcome_version) between 1 and 64),
  verdict text not null check (verdict in (
    'accepted', 'partially_accepted', 'rejected', 'needs_review'
  )),
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  private_evidence jsonb not null
    check (jsonb_typeof(private_evidence) = 'object'),
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz not null default now()
);

create table public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  evaluation_id uuid not null unique
    references excon_private.evaluations(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  feedback_level smallint not null check (feedback_level between 0 and 6),
  verdict text not null,
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  summary_i18n jsonb not null
    check (
      jsonb_typeof(summary_i18n) = 'object'
      and summary_i18n ?& array['zh-CN', 'en']
    ),
  guidance_i18n jsonb not null check (jsonb_typeof(guidance_i18n) = 'object'),
  allowed_actions text[] not null default '{}',
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (episode_id, recipient_user_id)
    references public.episode_members(episode_id, user_id) on delete restrict
);

create table excon_private.command_receipts (
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (length(operation) between 1 and 128),
  scope_key text not null check (length(scope_key) between 1 and 256),
  idempotency_key text not null
    check (length(idempotency_key) between 8 and 128),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  result_type text,
  result_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, operation, scope_key, idempotency_key),
  check (
    (completed_at is null and result_type is null and result_id is null)
    or (completed_at is not null and result_type is not null and result_id is not null)
  )
);

create table excon_private.episode_events (
  event_id bigint generated always as identity primary key,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  seq_no bigint not null check (seq_no > 0),
  event_type text not null check (length(event_type) between 1 and 128),
  audience text not null check (audience in ('participant', 'operator', 'internal')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  virtual_time timestamptz not null,
  occurred_at timestamptz not null default now(),
  object_type text,
  object_id uuid,
  safe_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_payload) = 'object'),
  schema_version integer not null default 1 check (schema_version > 0),
  previous_hash bytea,
  event_hash bytea not null check (octet_length(event_hash) = 32),
  unique (episode_id, seq_no),
  check (previous_hash is null or octet_length(previous_hash) = 32),
  check (
    (seq_no = 1 and previous_hash is null)
    or (seq_no > 1 and previous_hash is not null)
  )
);

create index scenario_versions_status_idx
  on public.scenario_versions (status, scenario_id);
create index scenarios_created_by_idx
  on public.scenarios (created_by);
create index participant_versions_owner_idx
  on public.participant_versions (owner_user_id, created_at desc);
create index episodes_scenario_state_idx
  on public.episodes (scenario_version_id, state);
create index episodes_participant_idx
  on public.episodes (participant_version_id, created_at desc);
create index episodes_parent_idx
  on public.episodes (parent_episode_id)
  where parent_episode_id is not null;
create index episode_members_user_episode_idx
  on public.episode_members (user_id, episode_id);
create index episode_members_participant_idx
  on public.episode_members (participant_version_id, episode_id);
create index information_items_release_idx
  on excon_private.information_items (scenario_version_id, release_virtual_at, id);
create index information_items_supersedes_idx
  on excon_private.information_items (supersedes_item_id)
  where supersedes_item_id is not null;
create index injects_due_idx
  on excon_private.injects (episode_id, planned_release_virtual_at, id)
  where state = 'pending';
create index injects_information_item_idx
  on excon_private.injects (information_item_id, episode_id);
create index observations_recipient_episode_idx
  on public.observations (recipient_user_id, episode_id, accessed_virtual_at);
create index observations_episode_recipient_idx
  on public.observations (episode_id, recipient_user_id);
create index observations_inject_episode_idx
  on public.observations (inject_id, episode_id);
create index submissions_actor_episode_idx
  on public.submissions (actor_user_id, episode_id, submitted_at desc);
create index submissions_participant_idx
  on public.submissions (participant_version_id, submitted_at desc);
create index submissions_episode_actor_participant_idx
  on public.submissions (episode_id, actor_user_id, participant_version_id);
create index submissions_revision_idx
  on public.submissions (revision_of)
  where revision_of is not null;
create index allocation_plans_actor_episode_idx
  on public.allocation_plans (actor_user_id, episode_id, created_at desc);
create index allocation_items_plan_idx
  on public.allocation_items (
    allocation_plan_id,
    actor_user_id,
    priority,
    starts_at
  );
create index allocation_items_actor_idx
  on public.allocation_items (actor_user_id, starts_at);
create index water_system_outcomes_lookup_idx
  on excon_private.water_system_outcomes (
    scenario_version_id,
    outcome_version,
    checkpoint_key
  );
create index evaluation_jobs_claim_idx
  on excon_private.evaluation_jobs (priority desc, run_after, id)
  where status = 'pending';
create index evaluation_jobs_episode_idx
  on excon_private.evaluation_jobs (episode_id, created_at desc);
create index evaluation_jobs_submission_idx
  on excon_private.evaluation_jobs (submission_id, created_at desc);
create index evaluations_submission_idx
  on excon_private.evaluations (submission_id, completed_at desc);
create index feedbacks_recipient_episode_idx
  on public.feedbacks (recipient_user_id, episode_id, created_at desc);
create index feedbacks_episode_recipient_idx
  on public.feedbacks (episode_id, recipient_user_id);
create index feedbacks_submission_idx
  on public.feedbacks (submission_id, created_at desc);
create index episode_events_actor_idx
  on excon_private.episode_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

create or replace function excon_private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
  return null;
end;
$$;

create or replace function excon_private.guard_scenario_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using
        errcode = '55000',
        message = 'published scenario versions are immutable';
    end if;
    return old;
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'published') then
    raise exception using errcode = '22023', message = 'invalid scenario version transition';
  elsif old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception using errcode = '22023', message = 'invalid scenario version transition';
  elsif old.status = 'retired' and new.status <> 'retired' then
    raise exception using errcode = '22023', message = 'retired scenario versions are terminal';
  end if;

  if old.status in ('published', 'retired') and (
    new.scenario_id,
    new.version_no,
    new.public_manifest,
    new.replay_start_at,
    new.replay_end_at,
    new.content_hash,
    new.published_at
  ) is distinct from (
    old.scenario_id,
    old.version_no,
    old.public_manifest,
    old.replay_start_at,
    old.replay_end_at,
    old.content_hash,
    old.published_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'published scenario version content is immutable';
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_episode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  replay_start timestamptz;
  replay_end timestamptz;
begin
  select v.replay_start_at, v.replay_end_at
    into replay_start, replay_end
  from public.scenario_versions as v
  where v.id = new.scenario_version_id;

  if not found or new.virtual_time < replay_start or new.virtual_time > replay_end then
    raise exception using
      errcode = '23514',
      message = 'episode virtual time is outside the scenario replay range';
  end if;

  if tg_op = 'UPDATE' then
    if (new.scenario_version_id, new.participant_version_id, new.mode)
      is distinct from
      (old.scenario_version_id, old.participant_version_id, old.mode) then
      raise exception using
        errcode = '55000',
        message = 'episode version bindings are immutable';
    end if;

    if new.virtual_time < old.virtual_time then
      raise exception using
        errcode = '22023',
        message = 'episode virtual time cannot move backwards';
    end if;

    if new.state <> old.state and not exists (
      select 1
      from (values
        ('created', 'initialized'),
        ('initialized', 'running'),
        ('running', 'waiting_for_submission'),
        ('waiting_for_submission', 'evaluation_queued'),
        ('evaluation_queued', 'evaluating'),
        ('waiting_for_submission', 'final_submitted'),
        ('evaluating', 'feedback_available'),
        ('evaluating', 'completed'),
        ('feedback_available', 'running'),
        ('final_submitted', 'waiting_for_outcome'),
        ('final_submitted', 'evaluating'),
        ('waiting_for_outcome', 'evaluating'),
        ('running', 'paused'),
        ('waiting_for_submission', 'paused'),
        ('paused', 'running'),
        ('paused', 'waiting_for_submission')
      ) as allowed(from_state, to_state)
      where allowed.from_state = old.state
        and allowed.to_state = new.state
    ) and not (
      new.state in ('cancelled', 'failed')
      and old.state not in ('completed', 'cancelled', 'failed')
    ) then
      raise exception using
        errcode = '22023',
        message = format('invalid episode transition: %s -> %s', old.state, new.state);
    end if;

    new.lock_version := old.lock_version + 1;
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_inject()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  episode_version uuid;
  episode_clock timestamptz;
  item_version uuid;
  item_release timestamptz;
begin
  select e.scenario_version_id, e.virtual_time
    into episode_version, episode_clock
  from public.episodes as e
  where e.id = new.episode_id;

  select i.scenario_version_id, i.release_virtual_at
    into item_version, item_release
  from excon_private.information_items as i
  where i.id = new.information_item_id;

  if episode_version is null or item_version is null or episode_version <> item_version then
    raise exception using
      errcode = '23514',
      message = 'inject information must belong to the episode scenario version';
  end if;

  if new.planned_release_virtual_at <> item_release then
    raise exception using
      errcode = '23514',
      message = 'inject release time must match the immutable information item';
  end if;

  if new.state = 'released' and new.released_virtual_at > episode_clock then
    raise exception using
      errcode = '23514',
      message = 'inject cannot be released ahead of the episode clock';
  end if;

  if tg_op = 'UPDATE' then
    if (new.episode_id, new.information_item_id, new.planned_release_virtual_at)
      is distinct from
      (old.episode_id, old.information_item_id, old.planned_release_virtual_at) then
      raise exception using errcode = '55000', message = 'inject identity is immutable';
    end if;

    if old.state = 'released' and new.state <> 'released' then
      raise exception using errcode = '55000', message = 'released injects cannot be reopened';
    end if;
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inject_state text;
  inject_release timestamptz;
  episode_clock timestamptz;
begin
  select i.state, i.released_virtual_at, e.virtual_time
    into inject_state, inject_release, episode_clock
  from excon_private.injects as i
  join public.episodes as e on e.id = i.episode_id
  where i.id = new.inject_id
    and i.episode_id = new.episode_id;

  if inject_state is distinct from 'released' then
    raise exception using
      errcode = '23514',
      message = 'inject must be released before observation';
  end if;

  if new.released_virtual_at <> inject_release
    or new.accessed_virtual_at < inject_release
    or new.accessed_virtual_at > episode_clock then
    raise exception using
      errcode = '23514',
      message = 'observation timestamps must follow the episode clock';
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_submission_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_episode uuid;
  parent_revision integer;
  episode_clock timestamptz;
begin
  select e.virtual_time
    into episode_clock
  from public.episodes as e
  where e.id = new.episode_id;

  if not found or new.submitted_virtual_at <> episode_clock then
    raise exception using
      errcode = '23514',
      message = 'submission virtual time must match the episode clock';
  end if;

  if new.revision_of is null then
    if new.revision_no <> 1 then
      raise exception using
        errcode = '23514',
        message = 'the first submission revision must be 1';
    end if;
    return new;
  end if;

  select s.episode_id, s.revision_no
    into parent_episode, parent_revision
  from public.submissions as s
  where s.id = new.revision_of;

  if parent_episode is null
    or parent_episode <> new.episode_id
    or new.revision_no <> parent_revision + 1 then
    raise exception using
      errcode = '23514',
      message = 'submission revisions must be consecutive within one episode';
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_allocation_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_start timestamptz;
  plan_end timestamptz;
begin
  select p.plan_start_at, p.plan_end_at
    into plan_start, plan_end
  from public.allocation_plans as p
  where p.id = new.allocation_plan_id;

  if plan_start is null or new.starts_at < plan_start or new.ends_at > plan_end then
    raise exception using
      errcode = '23514',
      message = 'allocation item must stay within its plan window';
  end if;

  return new;
end;
$$;

create or replace function excon_private.claim_evaluation_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease interval default interval '2 minutes'
)
returns setof excon_private.evaluation_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception using errcode = '22023', message = 'worker id is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'claim limit must be between 1 and 100';
  end if;

  if p_lease is null or p_lease <= interval '0 seconds' then
    raise exception using errcode = '22023', message = 'lease must be positive';
  end if;

  return query
  with picked as (
    select j.id
    from excon_private.evaluation_jobs as j
    where j.status = 'pending'
      and j.run_after <= now()
      and j.attempts < j.max_attempts
    order by j.priority desc, j.run_after, j.id
    for update of j skip locked
    limit p_limit
  )
  update excon_private.evaluation_jobs as j
  set status = 'processing',
      attempts = j.attempts + 1,
      locked_by = p_worker_id,
      locked_at = now(),
      lease_expires_at = now() + p_lease,
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create trigger scenario_versions_guard
before update or delete on public.scenario_versions
for each row execute function excon_private.guard_scenario_version();

create trigger episodes_guard
before insert or update on public.episodes
for each row execute function excon_private.guard_episode();

create trigger injects_guard
before insert or update on excon_private.injects
for each row execute function excon_private.guard_inject();

create trigger observations_time_guard
before insert on public.observations
for each row execute function excon_private.guard_observation();

create trigger submissions_revision_guard
before insert on public.submissions
for each row execute function excon_private.guard_submission_revision();

create trigger allocation_items_window_guard
before insert on public.allocation_items
for each row execute function excon_private.guard_allocation_item();

create trigger information_items_immutable
before update or delete on excon_private.information_items
for each row execute function excon_private.reject_immutable_mutation();
create trigger information_items_no_truncate
before truncate on excon_private.information_items
for each statement execute function excon_private.reject_immutable_mutation();

create trigger observations_immutable
before update or delete on public.observations
for each row execute function excon_private.reject_immutable_mutation();
create trigger observations_no_truncate
before truncate on public.observations
for each statement execute function excon_private.reject_immutable_mutation();

create trigger submissions_immutable
before update or delete on public.submissions
for each row execute function excon_private.reject_immutable_mutation();
create trigger submissions_no_truncate
before truncate on public.submissions
for each statement execute function excon_private.reject_immutable_mutation();

create trigger allocation_plans_immutable
before update or delete on public.allocation_plans
for each row execute function excon_private.reject_immutable_mutation();
create trigger allocation_plans_no_truncate
before truncate on public.allocation_plans
for each statement execute function excon_private.reject_immutable_mutation();

create trigger allocation_items_immutable
before update or delete on public.allocation_items
for each row execute function excon_private.reject_immutable_mutation();
create trigger allocation_items_no_truncate
before truncate on public.allocation_items
for each statement execute function excon_private.reject_immutable_mutation();

create trigger water_system_outcomes_immutable
before update or delete on excon_private.water_system_outcomes
for each row execute function excon_private.reject_immutable_mutation();
create trigger water_system_outcomes_no_truncate
before truncate on excon_private.water_system_outcomes
for each statement execute function excon_private.reject_immutable_mutation();

create trigger evaluations_immutable
before update or delete on excon_private.evaluations
for each row execute function excon_private.reject_immutable_mutation();
create trigger evaluations_no_truncate
before truncate on excon_private.evaluations
for each statement execute function excon_private.reject_immutable_mutation();

create trigger feedbacks_immutable
before update or delete on public.feedbacks
for each row execute function excon_private.reject_immutable_mutation();
create trigger feedbacks_no_truncate
before truncate on public.feedbacks
for each statement execute function excon_private.reject_immutable_mutation();

create trigger episode_events_immutable
before update or delete on excon_private.episode_events
for each row execute function excon_private.reject_immutable_mutation();
create trigger episode_events_no_truncate
before truncate on excon_private.episode_events
for each statement execute function excon_private.reject_immutable_mutation();

alter table public.scenarios enable row level security;
alter table public.scenario_versions enable row level security;
alter table public.participant_versions enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_members enable row level security;
alter table public.observations enable row level security;
alter table public.submissions enable row level security;
alter table public.allocation_plans enable row level security;
alter table public.allocation_items enable row level security;
alter table public.feedbacks enable row level security;

create policy scenarios_read_published
on public.scenarios for select
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions as v
    where v.scenario_id = scenarios.id
      and v.status = 'published'
  )
);

create policy scenario_versions_read_available
on public.scenario_versions for select
to authenticated
using (
  status = 'published'
  or exists (
    select 1
    from public.episodes as e
    join public.episode_members as m on m.episode_id = e.id
    where e.scenario_version_id = scenario_versions.id
      and m.user_id = (select auth.uid())
  )
);

create policy participant_versions_read_own
on public.participant_versions for select
to authenticated
using (owner_user_id = (select auth.uid()));

create policy episodes_read_member
on public.episodes for select
to authenticated
using (
  exists (
    select 1
    from public.episode_members as m
    where m.episode_id = episodes.id
      and m.user_id = (select auth.uid())
  )
);

create policy episode_members_read_self
on public.episode_members for select
to authenticated
using (user_id = (select auth.uid()));

create policy observations_read_recipient
on public.observations for select
to authenticated
using (recipient_user_id = (select auth.uid()));

create policy submissions_read_actor
on public.submissions for select
to authenticated
using (actor_user_id = (select auth.uid()));

create policy allocation_plans_read_actor
on public.allocation_plans for select
to authenticated
using (actor_user_id = (select auth.uid()));

create policy allocation_items_read_actor
on public.allocation_items for select
to authenticated
using (actor_user_id = (select auth.uid()));

create policy feedbacks_read_recipient
on public.feedbacks for select
to authenticated
using (recipient_user_id = (select auth.uid()));

revoke all on table
  public.scenarios,
  public.scenario_versions,
  public.participant_versions,
  public.episodes,
  public.episode_members,
  public.observations,
  public.submissions,
  public.allocation_plans,
  public.allocation_items,
  public.feedbacks
from anon, authenticated;

grant select on table
  public.scenarios,
  public.scenario_versions,
  public.participant_versions,
  public.episodes,
  public.episode_members,
  public.observations,
  public.submissions,
  public.allocation_plans,
  public.allocation_items,
  public.feedbacks
to authenticated;

revoke all on all tables in schema excon_private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema excon_private
  from public, anon, authenticated, service_role;
revoke execute on all functions in schema excon_private
  from public, anon, authenticated, service_role;

alter default privileges in schema excon_private
  revoke all on tables from public;
alter default privileges in schema excon_private
  revoke all on sequences from public;
alter default privileges in schema excon_private
  revoke execute on functions from public;
