set lock_timeout = '5s';
set statement_timeout = '60s';

create extension if not exists pgcrypto with schema extensions;

-- Scenario and agent catalog -------------------------------------------------

alter table public.scenario_versions
  drop constraint scenario_versions_status_check;

alter table public.scenario_versions
  add column owner_user_id uuid not null references auth.users(id) on delete restrict,
  add column lifecycle_version bigint not null default 0
    check (lifecycle_version >= 0),
  add column min_distinct_required_agents integer not null default 1
    check (min_distinct_required_agents > 0),
  add column compatibility_mode text not null default 'legacy_single_agent'
    check (compatibility_mode in ('legacy_single_agent', 'multi_agent')),
  add constraint scenario_versions_status_check
    check (status in ('draft', 'validating', 'published', 'retired')),
  add constraint scenario_versions_staffing_mode_check
    check (
      (compatibility_mode = 'legacy_single_agent' and min_distinct_required_agents = 1)
      or
      (compatibility_mode = 'multi_agent' and min_distinct_required_agents >= 2)
    );

create table public.scenario_version_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  lifecycle_seq bigint not null check (lifecycle_seq > 0),
  from_state text check (
    from_state is null
    or from_state in ('draft', 'validating', 'published', 'retired')
  ),
  to_state text not null
    check (to_state in ('draft', 'validating', 'published', 'retired')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(reason) between 1 and 1024),
  occurred_at timestamptz not null default now(),
  unique (scenario_version_id, lifecycle_seq)
);

create table public.role_definitions (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  role_key text not null check (role_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  title_i18n jsonb not null
    check (
      jsonb_typeof(title_i18n) = 'object'
      and title_i18n ?& array['zh-CN', 'en']
    ),
  description_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(description_i18n) = 'object'),
  is_required boolean not null default true,
  min_slots integer not null default 1 check (min_slots > 0),
  max_slots integer not null default 1 check (max_slots > 0),
  capability_requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capability_requirements) = 'array'),
  tool_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(tool_manifest) = 'object'),
  input_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output_schema) = 'object'),
  ordinal integer not null default 0 check (ordinal >= 0),
  created_at timestamptz not null default now(),
  unique (scenario_version_id, role_key),
  unique (id, scenario_version_id),
  check (min_slots <= max_slots)
);

create table public.agent_identities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  agent_key text not null check (agent_key ~ '^[a-z0-9][a-z0-9-]{2,127}$'),
  display_name_i18n jsonb not null
    check (
      jsonb_typeof(display_name_i18n) = 'object'
      and display_name_i18n ?& array['zh-CN', 'en']
    ),
  description_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(description_i18n) = 'object'),
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'suspended', 'revoked')),
  lifecycle_version bigint not null default 0 check (lifecycle_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, agent_key),
  unique (id, owner_user_id)
);

create table public.agent_identity_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  agent_identity_id uuid not null
    references public.agent_identities(id) on delete restrict,
  lifecycle_seq bigint not null check (lifecycle_seq > 0),
  from_state text check (
    from_state is null or from_state in ('active', 'suspended', 'revoked')
  ),
  to_state text not null check (to_state in ('active', 'suspended', 'revoked')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(reason) between 1 and 1024),
  occurred_at timestamptz not null default now(),
  unique (agent_identity_id, lifecycle_seq)
);

create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_identity_id uuid not null
    references public.agent_identities(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  version text not null check (length(version) between 1 and 64),
  lifecycle_state text not null default 'draft'
    check (lifecycle_state in ('draft', 'published', 'retired')),
  provider_kind text not null
    check (provider_kind in ('local_codex_subscription', 'openai_compatible')),
  model_ref text not null check (length(model_ref) between 1 and 256),
  protocol_version text not null check (length(protocol_version) between 1 and 64),
  skill_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(skill_manifest) = 'object'),
  tool_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(tool_manifest) = 'object'),
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array'),
  telemetry_capabilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(telemetry_capabilities) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agent_identity_id, version),
  unique (agent_identity_id, content_hash),
  unique (id, owner_user_id),
  foreign key (agent_identity_id, owner_user_id)
    references public.agent_identities(id, owner_user_id) on delete restrict,
  check (
    (lifecycle_state = 'draft' and published_at is null)
    or (lifecycle_state in ('published', 'retired') and published_at is not null)
  )
);

create table public.agent_version_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  agent_version_id uuid not null references public.agent_versions(id) on delete restrict,
  lifecycle_seq bigint not null check (lifecycle_seq > 0),
  from_state text check (
    from_state is null or from_state in ('draft', 'published', 'retired')
  ),
  to_state text not null check (to_state in ('draft', 'published', 'retired')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(reason) between 1 and 1024),
  occurred_at timestamptz not null default now(),
  unique (agent_version_id, lifecycle_seq)
);

-- Run, staffing, work, and barrier projections ------------------------------

create table public.exercise_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null
    references public.scenario_versions(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  mode text not null default 'historical_replay'
    check (mode in ('historical_replay', 'simulation')),
  state text not null default 'created' check (state in (
    'created', 'forming', 'ready', 'running', 'paused', 'completing',
    'completed', 'cancelled', 'failed'
  )),
  current_phase_key text,
  virtual_time timestamptz not null,
  lock_version bigint not null default 0 check (lock_version >= 0),
  parent_run_id uuid references public.exercise_runs(id) on delete restrict,
  fork_run_seq bigint check (fork_run_seq is null or fork_run_seq > 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (id, scenario_version_id),
  check (
    (parent_run_id is null and fork_run_seq is null)
    or (parent_run_id is not null and fork_run_seq is not null)
  ),
  check (
    (state = 'completed' and completed_at is not null)
    or (state <> 'completed' and completed_at is null)
  )
);

create table public.run_human_members (
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  member_role text not null check (member_role in ('operator', 'reviewer', 'observer')),
  created_at timestamptz not null default now(),
  primary key (run_id, user_id)
);

create table public.run_teams (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  team_key text not null check (team_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  title_i18n jsonb not null
    check (
      jsonb_typeof(title_i18n) = 'object'
      and title_i18n ?& array['zh-CN', 'en']
    ),
  created_at timestamptz not null default now(),
  unique (run_id, team_key),
  unique (id, run_id)
);

create table public.run_agents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  agent_version_id uuid not null references public.agent_versions(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  team_id uuid,
  instance_key text not null check (length(instance_key) between 1 and 128),
  state text not null default 'invited' check (state in (
    'invited', 'joined', 'ready', 'working', 'waiting_feedback', 'done',
    'disconnected', 'removed'
  )),
  lock_version bigint not null default 0 check (lock_version >= 0),
  joined_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, instance_key),
  unique (id, run_id),
  foreign key (agent_version_id, owner_user_id)
    references public.agent_versions(id, owner_user_id) on delete restrict,
  foreign key (team_id, run_id)
    references public.run_teams(id, run_id) on delete restrict,
  check (
    (state = 'invited' and joined_at is null)
    or (state <> 'invited' and joined_at is not null)
  )
);

create table public.run_role_assignments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  role_definition_id uuid not null references public.role_definitions(id) on delete restrict,
  slot_no integer not null default 1 check (slot_no > 0),
  assignment_kind text not null check (assignment_kind in ('primary', 'assistant')),
  counts_toward_quorum boolean not null default false,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  check (released_at is null or released_at >= assigned_at),
  check (
    (released_at is null and release_reason is null)
    or (released_at is not null and release_reason is not null)
  ),
  check (not counts_toward_quorum or assignment_kind = 'primary')
);

create unique index run_role_assignments_active_slot_idx
  on public.run_role_assignments (run_id, role_definition_id, slot_no)
  where released_at is null;
create unique index run_role_assignments_distinct_quorum_agent_idx
  on public.run_role_assignments (run_id, run_agent_id)
  where released_at is null and counts_toward_quorum;

create table public.run_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  task_key text not null check (task_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  eligible_role_definition_id uuid references public.role_definitions(id) on delete restrict,
  title_i18n jsonb not null
    check (
      jsonb_typeof(title_i18n) = 'object'
      and title_i18n ?& array['zh-CN', 'en']
    ),
  state text not null default 'blocked' check (state in (
    'blocked', 'ready', 'claimed', 'in_progress', 'submitted', 'evaluating',
    'rework_required', 'accepted', 'manual_hold', 'cancelled'
  )),
  lock_version bigint not null default 0 check (lock_version >= 0),
  claimed_by_run_agent_id uuid,
  claim_epoch bigint not null default 0 check (claim_epoch >= 0),
  lease_expires_at timestamptz,
  input_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_payload) = 'object'),
  output_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output_schema) = 'object'),
  priority smallint not null default 0,
  available_virtual_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (run_id, task_key),
  unique (id, run_id),
  foreign key (claimed_by_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  check (
    (state in ('claimed', 'in_progress')
      and claimed_by_run_agent_id is not null
      and lease_expires_at is not null)
    or
    (state not in ('claimed', 'in_progress')
      and claimed_by_run_agent_id is null
      and lease_expires_at is null)
  )
);

create table public.run_task_dependencies (
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  foreign key (task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  foreign key (depends_on_task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  check (task_id <> depends_on_task_id)
);

create table public.run_barriers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  barrier_key text not null check (barrier_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  barrier_type text not null
    check (barrier_type in ('all_required', 'quorum', 'role_quorum', 'operator_approval')),
  required_count integer not null check (required_count > 0),
  input_count integer not null default 0 check (input_count >= 0),
  state text not null default 'closed'
    check (state in ('closed', 'satisfied', 'released')),
  lock_version bigint not null default 0 check (lock_version >= 0),
  satisfied_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, barrier_key),
  unique (id, run_id),
  check (input_count <= required_count),
  check (
    (state = 'closed' and satisfied_at is null and released_at is null)
    or (state = 'satisfied' and satisfied_at is not null and released_at is null)
    or (state = 'released' and satisfied_at is not null and released_at is not null)
  )
);

-- Authoritative events, task claim history, and delivery evidence ------------

create table excon_private.run_event_heads (
  run_id uuid primary key references public.exercise_runs(id) on delete restrict,
  last_seq bigint not null default 0 check (last_seq >= 0),
  head_hash bytea,
  updated_at timestamptz not null default now(),
  check (head_hash is null or octet_length(head_hash) = 32),
  check ((last_seq = 0) = (head_hash is null))
);

create table excon_private.run_events (
  event_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_seq bigint not null check (run_seq > 0),
  stream_type text not null check (length(stream_type) between 1 and 64),
  stream_id uuid not null,
  event_type text not null check (length(event_type) between 1 and 128),
  actor_type text not null
    check (actor_type in ('run_agent', 'human_member', 'system', 'evaluator', 'external')),
  actor_id uuid,
  correlation_id uuid,
  causation_id uuid,
  virtual_time timestamptz not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  schema_version integer not null default 1 check (schema_version > 0),
  assertion_class text not null check (assertion_class in (
    'platform_observed', 'participant_reported', 'evaluator_derived',
    'operator_asserted', 'external_outcome'
  )),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  previous_hash bytea,
  event_hash bytea not null check (octet_length(event_hash) = 32),
  trace_id text check (trace_id is null or trace_id ~ '^[0-9a-f]{32}$'),
  span_id text check (span_id is null or span_id ~ '^[0-9a-f]{16}$'),
  unique (run_id, run_seq),
  unique (event_id, run_id),
  unique (event_id, run_id, run_seq),
  check (previous_hash is null or octet_length(previous_hash) = 32),
  check (
    (run_seq = 1 and previous_hash is null)
    or (run_seq > 1 and previous_hash is not null)
  )
);

create table excon_private.outbox (
  id bigint generated always as identity primary key,
  event_id uuid not null unique
    references excon_private.run_events(event_id) on delete restrict,
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  topic text not null check (length(topic) between 1 and 128),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'published', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'processing' and locked_by is not null and locked_at is not null)
    or status <> 'processing'
  ),
  check ((status = 'published') = (published_at is not null))
);

create table excon_private.run_task_claims (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  run_id uuid not null,
  run_agent_id uuid not null,
  claim_epoch bigint not null check (claim_epoch > 0),
  lease_token_hash bytea not null check (octet_length(lease_token_hash) = 32),
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text check (release_reason in (
    'completed', 'released', 'expired', 'agent_state', 'operator', 'replaced'
  )),
  foreign key (task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (task_id, claim_epoch),
  check (claimed_at < lease_expires_at),
  check (
    (released_at is null and release_reason is null)
    or (released_at is not null and release_reason is not null and released_at >= claimed_at)
  )
);

create unique index run_task_claims_one_active_idx
  on excon_private.run_task_claims (task_id)
  where released_at is null;

create table excon_private.run_barrier_inputs (
  id uuid primary key default gen_random_uuid(),
  barrier_id uuid not null,
  run_id uuid not null,
  condition_key text not null check (length(condition_key) between 1 and 128),
  source_event_id uuid not null,
  source_run_seq bigint not null check (source_run_seq > 0),
  recorded_at timestamptz not null default now(),
  foreign key (barrier_id, run_id)
    references public.run_barriers(id, run_id) on delete restrict,
  foreign key (source_event_id, run_id, source_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  unique (barrier_id, condition_key, source_event_id)
);

create table excon_private.agent_receipt_heads (
  run_agent_id uuid primary key,
  run_id uuid not null,
  last_seq bigint not null default 0 check (last_seq >= 0),
  head_hash bytea,
  updated_at timestamptz not null default now(),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  check (head_hash is null or octet_length(head_hash) = 32),
  check ((last_seq = 0) = (head_hash is null))
);

create table public.event_disclosures (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  source_event_id uuid not null,
  source_run_seq bigint not null check (source_run_seq > 0),
  granted_event_id uuid not null,
  granted_run_seq bigint not null check (granted_run_seq > 0),
  resource_type text not null check (length(resource_type) between 1 and 64),
  resource_id uuid not null,
  resource_version text not null check (length(resource_version) between 1 and 128),
  available_virtual_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  foreign key (source_event_id, run_id, source_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  foreign key (granted_event_id, run_id, granted_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  unique (run_agent_id, resource_type, resource_id, resource_version),
  unique (id, run_id, run_agent_id)
);

create table public.delivery_batches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  after_receipt_seq bigint not null default 0 check (after_receipt_seq >= 0),
  from_receipt_seq bigint check (from_receipt_seq > 0),
  through_receipt_seq bigint check (through_receipt_seq > 0),
  receipt_head_hash bytea,
  run_cursor bigint not null check (run_cursor >= 0),
  has_more boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (run_agent_id, idempotency_key),
  unique (id, run_id, run_agent_id),
  check (receipt_head_hash is null or octet_length(receipt_head_hash) = 32),
  check (
    (from_receipt_seq is null and through_receipt_seq is null and receipt_head_hash is null)
    or
    (from_receipt_seq is not null
      and through_receipt_seq is not null
      and receipt_head_hash is not null
      and from_receipt_seq <= through_receipt_seq)
  )
);

create table public.agent_view_receipts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  agent_receipt_seq bigint not null check (agent_receipt_seq > 0),
  delivery_batch_id uuid not null,
  disclosure_id uuid not null,
  source_event_id uuid not null,
  source_run_seq bigint not null check (source_run_seq > 0),
  issued_event_id uuid not null,
  issued_run_seq bigint not null check (issued_run_seq > 0),
  view_kind text not null check (view_kind in (
    'inject', 'task', 'message', 'artifact', 'feedback', 'submission',
    'role_assignment', 'system'
  )),
  resource_type text not null check (length(resource_type) between 1 and 64),
  resource_id uuid not null,
  resource_version text not null check (length(resource_version) between 1 and 128),
  available_virtual_at timestamptz not null,
  issued_virtual_at timestamptz not null,
  issued_at timestamptz not null default now(),
  schema_version integer not null default 1 check (schema_version > 0),
  content_snapshot jsonb not null check (jsonb_typeof(content_snapshot) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  previous_receipt_hash bytea,
  receipt_hash bytea not null check (octet_length(receipt_hash) = 32),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  foreign key (delivery_batch_id, run_id, run_agent_id)
    references public.delivery_batches(id, run_id, run_agent_id) on delete restrict,
  foreign key (disclosure_id, run_id, run_agent_id)
    references public.event_disclosures(id, run_id, run_agent_id) on delete restrict,
  foreign key (source_event_id, run_id, source_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  foreign key (issued_event_id, run_id, issued_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  unique (run_agent_id, agent_receipt_seq),
  unique (run_agent_id, disclosure_id),
  unique (id, run_id, run_agent_id),
  check (previous_receipt_hash is null or octet_length(previous_receipt_hash) = 32),
  check (
    (agent_receipt_seq = 1 and previous_receipt_hash is null)
    or (agent_receipt_seq > 1 and previous_receipt_hash is not null)
  ),
  check (source_run_seq <= issued_run_seq),
  check (available_virtual_at <= issued_virtual_at)
);

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  delivery_batch_id uuid not null,
  through_receipt_seq bigint not null check (through_receipt_seq > 0),
  acknowledged_head_hash bytea not null
    check (octet_length(acknowledged_head_hash) = 32),
  acknowledged_event_id uuid not null,
  acknowledged_run_seq bigint not null check (acknowledged_run_seq > 0),
  command_receipt_key text,
  acknowledged_at timestamptz not null default now(),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  foreign key (delivery_batch_id, run_id, run_agent_id)
    references public.delivery_batches(id, run_id, run_agent_id) on delete restrict,
  foreign key (acknowledged_event_id, run_id, acknowledged_run_seq)
    references excon_private.run_events(event_id, run_id, run_seq) on delete restrict,
  unique (run_agent_id, delivery_batch_id),
  unique (run_agent_id, through_receipt_seq, acknowledged_head_hash),
  check (command_receipt_key is null or length(command_receipt_key) between 8 and 256)
);

-- Explicit multi-agent collaboration and evaluation -------------------------

create table public.run_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  sender_run_agent_id uuid not null,
  kind text not null default 'inform'
    check (kind in ('inform', 'request', 'response', 'handoff')),
  thread_id uuid not null,
  reply_to_message_id uuid,
  audience text not null check (audience in ('agent', 'role', 'team', 'operator', 'reviewer')),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  artifact_version_refs jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(artifact_version_refs) = 'array'
      and (kind <> 'handoff' or jsonb_array_length(artifact_version_refs) > 0)
    ),
  participant_reported boolean not null default true,
  sent_virtual_at timestamptz not null,
  sent_at timestamptz not null default now(),
  foreign key (sender_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (id, run_id),
  foreign key (thread_id, run_id)
    references public.run_messages(id, run_id) on delete restrict,
  foreign key (reply_to_message_id, run_id)
    references public.run_messages(id, run_id) on delete restrict,
  check ((kind = 'response') = (reply_to_message_id is not null))
);

create table public.run_message_recipients (
  message_id uuid not null,
  run_id uuid not null,
  recipient_run_agent_id uuid not null,
  granted_run_seq bigint not null check (granted_run_seq > 0),
  created_at timestamptz not null default now(),
  primary key (message_id, recipient_run_agent_id),
  foreign key (message_id, run_id)
    references public.run_messages(id, run_id) on delete restrict,
  foreign key (recipient_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict
);

create table public.run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  artifact_key text not null check (artifact_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  artifact_type text not null check (length(artifact_type) between 1 and 64),
  title_i18n jsonb not null
    check (
      jsonb_typeof(title_i18n) = 'object'
      and title_i18n ?& array['zh-CN', 'en']
    ),
  created_by_run_agent_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (created_by_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (run_id, artifact_key),
  unique (id, run_id)
);

create table public.run_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  run_id uuid not null,
  version_no integer not null check (version_no > 0),
  base_version_id uuid references public.run_artifact_versions(id) on delete restrict,
  author_run_agent_id uuid not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  participant_reported boolean not null default true,
  created_virtual_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (artifact_id, run_id)
    references public.run_artifacts(id, run_id) on delete restrict,
  foreign key (author_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (artifact_id, version_no),
  unique (artifact_id, content_hash),
  unique (id, artifact_id, run_id)
);

create table public.run_artifact_recipients (
  artifact_version_id uuid not null,
  artifact_id uuid not null,
  run_id uuid not null,
  recipient_run_agent_id uuid not null,
  granted_run_seq bigint not null check (granted_run_seq > 0),
  created_at timestamptz not null default now(),
  primary key (artifact_version_id, recipient_run_agent_id),
  foreign key (artifact_version_id, artifact_id, run_id)
    references public.run_artifact_versions(id, artifact_id, run_id) on delete restrict,
  foreign key (recipient_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict
);

create table public.run_submissions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  task_id uuid,
  actor_run_agent_id uuid not null,
  target_scope text not null check (target_scope in ('individual', 'role', 'team', 'run')),
  role_definition_id uuid references public.role_definitions(id) on delete restrict,
  team_id uuid,
  revision_no integer not null check (revision_no > 0),
  revision_of_id uuid references public.run_submissions(id) on delete restrict,
  submission_type text not null check (length(submission_type) between 1 and 128),
  is_final boolean not null default false,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  submitted_virtual_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  foreign key (task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  foreign key (actor_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  foreign key (team_id, run_id)
    references public.run_teams(id, run_id) on delete restrict,
  unique (id, run_id),
  unique (run_id, actor_run_agent_id, submission_type, revision_no),
  check (
    (target_scope = 'role' and role_definition_id is not null)
    or (target_scope = 'team' and team_id is not null)
    or target_scope in ('individual', 'run')
  ),
  check (
    (revision_no = 1 and revision_of_id is null)
    or (revision_no > 1 and revision_of_id is not null)
  )
);

create unique index run_submissions_one_final_task_idx
  on public.run_submissions (task_id)
  where task_id is not null and is_final;

create table public.run_submission_contributors (
  submission_id uuid not null,
  run_id uuid not null,
  run_agent_id uuid not null,
  contribution_basis text not null check (contribution_basis in (
    'task_acceptance', 'artifact_authorship', 'message_receipt', 'endorsement',
    'participant_reported'
  )),
  basis_resource_id uuid,
  assertion_class text not null check (assertion_class in (
    'platform_observed', 'participant_reported', 'evaluator_derived', 'operator_asserted'
  )),
  created_at timestamptz not null default now(),
  primary key (submission_id, run_agent_id, contribution_basis),
  foreign key (submission_id, run_id)
    references public.run_submissions(id, run_id) on delete restrict,
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict
);

create table public.run_evaluations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  submission_id uuid,
  task_id uuid,
  target_scope text not null check (target_scope in ('individual', 'role', 'team', 'run')),
  target_id uuid not null,
  evaluator_key text not null check (length(evaluator_key) between 1 and 128),
  evaluator_version text not null check (length(evaluator_version) between 1 and 64),
  evaluation_method text not null
    check (evaluation_method in ('deterministic', 'human_review')),
  rules_version text not null check (length(rules_version) between 1 and 64),
  verdict text not null check (verdict in (
    'accepted', 'partially_accepted', 'rejected', 'needs_review'
  )),
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  safe_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_evidence) = 'object'),
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz not null default now(),
  foreign key (submission_id, run_id)
    references public.run_submissions(id, run_id) on delete restrict,
  foreign key (task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  unique (id, run_id)
);

create table excon_private.run_evaluation_evidence (
  evaluation_id uuid primary key,
  run_id uuid not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  evidence_hash bytea not null check (octet_length(evidence_hash) = 32),
  created_at timestamptz not null default now(),
  foreign key (evaluation_id, run_id)
    references public.run_evaluations(id, run_id) on delete restrict
);

create table public.run_feedbacks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  evaluation_id uuid not null,
  target_scope text not null check (target_scope in ('individual', 'role', 'team')),
  summary_i18n jsonb not null
    check (
      jsonb_typeof(summary_i18n) = 'object'
      and summary_i18n ?& array['zh-CN', 'en']
    ),
  guidance_i18n jsonb not null
    check (
      jsonb_typeof(guidance_i18n) = 'object'
      and guidance_i18n ?& array['zh-CN', 'en']
    ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (evaluation_id, run_id)
    references public.run_evaluations(id, run_id) on delete restrict,
  unique (id, run_id)
);

create table public.run_feedback_recipients (
  feedback_id uuid not null,
  run_id uuid not null,
  recipient_run_agent_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (feedback_id, recipient_run_agent_id),
  foreign key (feedback_id, run_id)
    references public.run_feedbacks(id, run_id) on delete restrict,
  foreign key (recipient_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict
);

create table public.feedback_action_grants (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  feedback_id uuid not null,
  target_run_agent_id uuid not null,
  target_task_id uuid not null,
  action text not null check (action in (
    'revise_task', 'resubmit', 'endorse', 'request_clarification'
  )),
  predecessor_submission_id uuid references public.run_submissions(id) on delete restrict,
  evaluation_id uuid not null,
  issued_run_seq bigint not null check (issued_run_seq > 0),
  expires_virtual_at timestamptz,
  expires_at timestamptz,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  revoked_run_seq bigint check (revoked_run_seq is null or revoked_run_seq > issued_run_seq),
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (feedback_id, run_id)
    references public.run_feedbacks(id, run_id) on delete restrict,
  foreign key (target_run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  foreign key (target_task_id, run_id)
    references public.run_tasks(id, run_id) on delete restrict,
  foreign key (evaluation_id, run_id)
    references public.run_evaluations(id, run_id) on delete restrict,
  check (used_count <= max_uses)
);

-- Run-agent credentials and authenticated telemetry ingress -----------------

create table excon_private.run_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  run_agent_id uuid not null,
  run_id uuid not null,
  token_key_id text not null check (length(token_key_id) between 1 and 64),
  token_hash bytea not null check (octet_length(token_hash) = 32),
  scopes text[] not null check (cardinality(scopes) > 0),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from_id uuid references excon_private.run_agent_credentials(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (run_agent_id, token_key_id),
  unique (token_hash),
  check (issued_at < expires_at),
  check (revoked_at is null or revoked_at >= issued_at)
);

create unique index run_agent_credentials_one_active_idx
  on excon_private.run_agent_credentials (run_agent_id)
  where revoked_at is null;

create table excon_private.telemetry_sessions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.exercise_runs(id) on delete restrict,
  run_agent_id uuid not null,
  credential_id uuid not null
    references excon_private.run_agent_credentials(id) on delete restrict,
  session_key text not null check (length(session_key) between 8 and 128),
  trust_class text not null default 'participant_reported'
    check (trust_class in ('participant_reported', 'platform_observed')),
  resource_attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resource_attributes) = 'object'),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  revoked_at timestamptz,
  accepted_span_count bigint not null default 0 check (accepted_span_count >= 0),
  rejected_span_count bigint not null default 0 check (rejected_span_count >= 0),
  foreign key (run_agent_id, run_id)
    references public.run_agents(id, run_id) on delete restrict,
  unique (run_agent_id, session_key),
  check (started_at <= last_seen_at),
  check (ended_at is null or ended_at >= started_at),
  check (revoked_at is null or revoked_at >= started_at)
);

-- Integrity functions --------------------------------------------------------

create or replace function excon_private.guard_scenario_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  required_role_count integer;
  required_slot_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.published_at is not null or new.lifecycle_version <> 0 then
      raise exception using
        errcode = '23514',
        message = 'scenario versions must begin as drafts';
    end if;
    if new.owner_user_id is distinct from (
      select scenario.created_by
      from public.scenarios as scenario
      where scenario.id = new.scenario_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'scenario version owner must match the scenario owner';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using
        errcode = '55000',
        message = 'published scenario versions are immutable';
    end if;
    return old;
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'validating', 'published') then
    raise exception using errcode = '22023', message = 'invalid scenario version transition';
  elsif old.status = 'validating' and new.status not in ('draft', 'validating', 'published') then
    raise exception using errcode = '22023', message = 'invalid scenario version transition';
  elsif old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception using errcode = '22023', message = 'invalid scenario version transition';
  elsif old.status = 'retired' and new.status <> 'retired' then
    raise exception using errcode = '22023', message = 'retired scenario versions are terminal';
  end if;

  if old.status in ('published', 'retired') and (
    new.scenario_id,
    new.owner_user_id,
    new.version_no,
    new.public_manifest,
    new.replay_start_at,
    new.replay_end_at,
    new.content_hash,
    new.published_at,
    new.min_distinct_required_agents,
    new.compatibility_mode
  ) is distinct from (
    old.scenario_id,
    old.owner_user_id,
    old.version_no,
    old.public_manifest,
    old.replay_start_at,
    old.replay_end_at,
    old.content_hash,
    old.published_at,
    old.min_distinct_required_agents,
    old.compatibility_mode
  ) then
    raise exception using
      errcode = '55000',
      message = 'published scenario version content is immutable';
  end if;

  if new.status = 'published' and old.status <> 'published' then
    select count(*), coalesce(sum(r.min_slots), 0)
      into required_role_count, required_slot_count
    from public.role_definitions as r
    where r.scenario_version_id = new.id
      and r.is_required;

    if new.compatibility_mode = 'multi_agent' and (
      required_role_count < 2
      or required_slot_count < new.min_distinct_required_agents
    ) then
      raise exception using
        errcode = '23514',
        message = 'published multi-agent scenarios require enough required role slots';
    end if;
  end if;

  if new.status is distinct from old.status then
    new.lifecycle_version := old.lifecycle_version + 1;
  elsif new.lifecycle_version <> old.lifecycle_version then
    raise exception using
      errcode = '55000',
      message = 'scenario lifecycle version is system managed';
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_role_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_state text;
begin
  select v.status into parent_state
  from public.scenario_versions as v
  where v.id = coalesce(new.scenario_version_id, old.scenario_version_id);

  if parent_state in ('published', 'retired') then
    raise exception using
      errcode = '55000',
      message = 'published role definitions are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function excon_private.guard_agent_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owner_user_id <> new.owner_user_id or old.agent_key <> new.agent_key then
    raise exception using errcode = '55000', message = 'agent identity binding is immutable';
  end if;

  if old.lifecycle_state = 'revoked' and new.lifecycle_state <> 'revoked' then
    raise exception using errcode = '55000', message = 'revoked agent identities are terminal';
  end if;

  if old.lifecycle_state <> new.lifecycle_state then
    if not (
      (old.lifecycle_state = 'active' and new.lifecycle_state in ('suspended', 'revoked'))
      or (old.lifecycle_state = 'suspended' and new.lifecycle_state in ('active', 'revoked'))
    ) then
      raise exception using errcode = '22023', message = 'invalid agent identity transition';
    end if;
    new.lifecycle_version := old.lifecycle_version + 1;
  elsif new.lifecycle_version <> old.lifecycle_version then
    raise exception using errcode = '55000', message = 'agent lifecycle version is system managed';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function excon_private.guard_agent_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  identity_owner uuid;
  identity_state text;
begin
  if tg_op = 'INSERT' then
    select identity.owner_user_id, identity.lifecycle_state
      into identity_owner, identity_state
    from public.agent_identities as identity
    where identity.id = new.agent_identity_id;

    if identity_owner is distinct from new.owner_user_id or identity_state <> 'active' then
      raise exception using
        errcode = '23514',
        message = 'agent version requires its active owning identity';
    end if;
    if new.lifecycle_state <> 'draft' or new.published_at is not null then
      raise exception using
        errcode = '23514',
        message = 'agent versions must begin as drafts';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.lifecycle_state <> 'draft' then
      raise exception using errcode = '55000', message = 'published agent versions are immutable';
    end if;
    return old;
  end if;

  if old.lifecycle_state = 'draft' and new.lifecycle_state not in ('draft', 'published') then
    raise exception using errcode = '22023', message = 'invalid agent version transition';
  elsif old.lifecycle_state = 'published' and new.lifecycle_state not in ('published', 'retired') then
    raise exception using errcode = '22023', message = 'invalid agent version transition';
  elsif old.lifecycle_state = 'retired' and new.lifecycle_state <> 'retired' then
    raise exception using errcode = '22023', message = 'retired agent versions are terminal';
  end if;

  if old.lifecycle_state in ('published', 'retired') and new is distinct from old then
    if new.lifecycle_state = old.lifecycle_state then
      raise exception using errcode = '55000', message = 'published agent versions are immutable';
    end if;
    if (
      new.agent_identity_id,
      new.owner_user_id,
      new.version,
      new.provider_kind,
      new.model_ref,
      new.protocol_version,
      new.skill_manifest,
      new.tool_manifest,
      new.capabilities,
      new.telemetry_capabilities,
      new.content_hash,
      new.published_at,
      new.created_at
    ) is distinct from (
      old.agent_identity_id,
      old.owner_user_id,
      old.version,
      old.provider_kind,
      old.model_ref,
      old.protocol_version,
      old.skill_manifest,
      old.tool_manifest,
      old.capabilities,
      old.telemetry_capabilities,
      old.content_hash,
      old.published_at,
      old.created_at
    ) then
      raise exception using errcode = '55000', message = 'published agent versions are immutable';
    end if;
  end if;

  return new;
end;
$$;

create or replace function excon_private.assert_run_staffing(p_run_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  version_id uuid;
  minimum_distinct integer;
  missing_roles integer;
  distinct_agents integer;
begin
  select r.scenario_version_id, v.min_distinct_required_agents
    into version_id, minimum_distinct
  from public.exercise_runs as r
  join public.scenario_versions as v on v.id = r.scenario_version_id
  where r.id = p_run_id;

  if not found then
    raise exception using errcode = '22023', message = 'run does not exist';
  end if;

  select count(*) into missing_roles
  from public.role_definitions as role
  where role.scenario_version_id = version_id
    and role.is_required
    and (
      select count(*)
      from public.run_role_assignments as assignment
      where assignment.run_id = p_run_id
        and assignment.role_definition_id = role.id
        and assignment.counts_toward_quorum
        and assignment.released_at is null
    ) < role.min_slots;

  select count(distinct assignment.run_agent_id) into distinct_agents
  from public.run_role_assignments as assignment
  join public.run_agents as agent
    on agent.id = assignment.run_agent_id
    and agent.run_id = assignment.run_id
  where assignment.run_id = p_run_id
    and assignment.counts_toward_quorum
    and assignment.released_at is null
    and agent.state in ('ready', 'working', 'waiting_feedback', 'done');

  if missing_roles > 0 or distinct_agents < minimum_distinct then
    raise exception using
      errcode = '23514',
      message = 'run does not satisfy required-role staffing';
  end if;
end;
$$;

create or replace function excon_private.guard_exercise_run()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  replay_start timestamptz;
  replay_end timestamptz;
  version_state text;
begin
  select v.replay_start_at, v.replay_end_at, v.status
    into replay_start, replay_end, version_state
  from public.scenario_versions as v
  where v.id = new.scenario_version_id;

  if new.virtual_time < replay_start or new.virtual_time > replay_end then
    raise exception using errcode = '23514', message = 'run virtual time is outside scenario range';
  end if;

  if tg_op = 'INSERT' then
    if version_state <> 'published' then
      raise exception using errcode = '23514', message = 'runs require a published scenario version';
    end if;
    return new;
  end if;

  if (new.scenario_version_id, new.created_by, new.mode, new.parent_run_id, new.fork_run_seq)
    is distinct from
    (old.scenario_version_id, old.created_by, old.mode, old.parent_run_id, old.fork_run_seq) then
    raise exception using errcode = '55000', message = 'run bindings are immutable';
  end if;

  if new.virtual_time < old.virtual_time then
    raise exception using errcode = '22023', message = 'run virtual time cannot move backwards';
  end if;

  if new.state <> old.state and not exists (
    select 1 from (values
      ('created', 'forming'),
      ('forming', 'ready'),
      ('ready', 'running'),
      ('running', 'paused'),
      ('paused', 'running'),
      ('running', 'completing'),
      ('completing', 'completed')
    ) as allowed(from_state, to_state)
    where allowed.from_state = old.state and allowed.to_state = new.state
  ) and not (
    new.state in ('cancelled', 'failed')
    and old.state not in ('completed', 'cancelled', 'failed')
  ) then
    raise exception using
      errcode = '22023',
      message = format('invalid run transition: %s -> %s', old.state, new.state);
  end if;

  if old.state = 'forming' and new.state = 'ready' then
    perform excon_private.assert_run_staffing(new.id);
  end if;

  new.lock_version := old.lock_version + 1;
  return new;
end;
$$;

create or replace function excon_private.guard_run_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  run_version uuid;
  role_version uuid;
  required_role boolean;
  maximum_slots integer;
  run_state text;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'role assignment history is append-only';
  end if;

  if tg_op = 'UPDATE' then
    if (
      new.run_id,
      new.run_agent_id,
      new.role_definition_id,
      new.slot_no,
      new.assignment_kind,
      new.counts_toward_quorum,
      new.assigned_at
    ) is distinct from (
      old.run_id,
      old.run_agent_id,
      old.role_definition_id,
      old.slot_no,
      old.assignment_kind,
      old.counts_toward_quorum,
      old.assigned_at
    ) then
      raise exception using errcode = '55000', message = 'role assignment identity is immutable';
    end if;
    if old.released_at is not null then
      raise exception using errcode = '55000', message = 'released role assignments are immutable';
    end if;
    return new;
  end if;

  select r.scenario_version_id, r.state
    into run_version, run_state
  from public.exercise_runs as r
  where r.id = new.run_id;

  select role.scenario_version_id, role.is_required, role.max_slots
    into role_version, required_role, maximum_slots
  from public.role_definitions as role
  where role.id = new.role_definition_id;

  if run_version <> role_version then
    raise exception using errcode = '23514', message = 'role does not belong to the run scenario version';
  end if;
  if run_state not in ('created', 'forming') then
    raise exception using errcode = '55000', message = 'run staffing is closed';
  end if;
  if new.slot_no > maximum_slots then
    raise exception using errcode = '23514', message = 'role slot exceeds the published maximum';
  end if;
  if new.counts_toward_quorum is distinct from (required_role and new.assignment_kind = 'primary') then
    raise exception using errcode = '23514', message = 'required primary assignment quorum flag is invalid';
  end if;

  return new;
end;
$$;

create or replace function excon_private.claim_run_task(
  p_task_id uuid,
  p_run_agent_id uuid,
  p_expected_lock_version bigint,
  p_lease_token_hash bytea,
  p_lease interval default interval '2 minutes'
)
returns public.run_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task_row public.run_tasks%rowtype;
  agent_is_eligible boolean;
  new_epoch bigint;
begin
  if p_lease_token_hash is null or octet_length(p_lease_token_hash) <> 32 then
    raise exception using errcode = '22023', message = 'lease token hash must be 32 bytes';
  end if;
  if p_lease is null or p_lease < interval '1 second' or p_lease > interval '1 hour' then
    raise exception using errcode = '22023', message = 'lease must be between one second and one hour';
  end if;

  select * into task_row
  from public.run_tasks as task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'task does not exist';
  end if;
  if task_row.lock_version <> p_expected_lock_version then
    raise exception using errcode = '40001', message = 'task version conflict';
  end if;
  if task_row.state not in ('ready', 'rework_required') then
    raise exception using errcode = '55000', message = 'task is not claimable';
  end if;

  select exists (
    select 1
    from public.run_agents as agent
    join public.run_role_assignments as assignment
      on assignment.run_agent_id = agent.id
      and assignment.run_id = agent.run_id
      and assignment.released_at is null
    where agent.id = p_run_agent_id
      and agent.run_id = task_row.run_id
      and agent.state in ('ready', 'working', 'waiting_feedback')
      and (
        task_row.eligible_role_definition_id is null
        or assignment.role_definition_id = task_row.eligible_role_definition_id
      )
  ) into agent_is_eligible;

  if not agent_is_eligible then
    raise exception using errcode = '42501', message = 'run agent is not eligible for the task';
  end if;

  new_epoch := task_row.claim_epoch + 1;

  insert into excon_private.run_task_claims (
    task_id,
    run_id,
    run_agent_id,
    claim_epoch,
    lease_token_hash,
    lease_expires_at
  ) values (
    task_row.id,
    task_row.run_id,
    p_run_agent_id,
    new_epoch,
    p_lease_token_hash,
    now() + p_lease
  );

  update public.run_tasks as task
  set state = 'claimed',
      claimed_by_run_agent_id = p_run_agent_id,
      claim_epoch = new_epoch,
      lease_expires_at = now() + p_lease,
      lock_version = task.lock_version + 1
  where task.id = task_row.id
  returning * into task_row;

  return task_row;
end;
$$;

create or replace function excon_private.initialize_run_event_head()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into excon_private.run_event_heads (run_id) values (new.id);
  return new;
end;
$$;

create or replace function excon_private.initialize_agent_receipt_head()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into excon_private.agent_receipt_heads (run_agent_id, run_id)
  values (new.id, new.run_id);
  return new;
end;
$$;

create or replace function excon_private.guard_run_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('excon_private.event_append', true) is distinct from 'on' then
    raise exception using errcode = '55000', message = 'run events must use append_run_event';
  end if;
  return new;
end;
$$;

create or replace function excon_private.append_run_event(
  p_run_id uuid,
  p_event_type text,
  p_stream_type text,
  p_stream_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_assertion_class text,
  p_causation_id uuid,
  p_correlation_kind text,
  p_virtual_time timestamptz,
  p_payload jsonb,
  p_correlation_id uuid default null,
  p_event_id uuid default null,
  p_trace_id text default null,
  p_span_id text default null
)
returns excon_private.run_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  head_row excon_private.run_event_heads%rowtype;
  result_row excon_private.run_events%rowtype;
  next_seq bigint;
  next_event_id uuid;
  payload_digest bytea;
  next_hash bytea;
  run_clock timestamptz;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'event payload must be an object';
  end if;
  if p_correlation_kind is null or length(p_correlation_kind) not between 1 and 64 then
    raise exception using errcode = '22023', message = 'correlation kind is required';
  end if;

  select r.virtual_time into run_clock
  from public.exercise_runs as r
  where r.id = p_run_id;
  if not found then
    raise exception using errcode = '22023', message = 'run does not exist';
  end if;
  if p_virtual_time > run_clock then
    raise exception using errcode = '23514', message = 'event virtual time exceeds the run clock';
  end if;

  select * into head_row
  from excon_private.run_event_heads as head
  where head.run_id = p_run_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'run event head is missing';
  end if;

  next_seq := head_row.last_seq + 1;
  next_event_id := coalesce(p_event_id, gen_random_uuid());
  payload_digest := extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256');
  next_hash := extensions.digest(
    coalesce(head_row.head_hash, ''::bytea)
    || convert_to(
      concat_ws(
        '|',
        p_run_id::text,
        next_seq::text,
        next_event_id::text,
        p_event_type,
        p_stream_type,
        p_stream_id::text,
        p_actor_type,
        coalesce(p_actor_id::text, ''),
        p_assertion_class,
        p_correlation_kind,
        p_virtual_time::text
      ),
      'UTF8'
    )
    || payload_digest,
    'sha256'
  );

  perform set_config('excon_private.event_append', 'on', true);

  insert into excon_private.run_events (
    event_id,
    run_id,
    run_seq,
    stream_type,
    stream_id,
    event_type,
    actor_type,
    actor_id,
    correlation_id,
    causation_id,
    virtual_time,
    assertion_class,
    payload,
    payload_hash,
    previous_hash,
    event_hash,
    trace_id,
    span_id
  ) values (
    next_event_id,
    p_run_id,
    next_seq,
    p_stream_type,
    p_stream_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    p_correlation_id,
    p_causation_id,
    p_virtual_time,
    p_assertion_class,
    p_payload,
    payload_digest,
    head_row.head_hash,
    next_hash,
    p_trace_id,
    p_span_id
  ) returning * into result_row;

  update excon_private.run_event_heads as head
  set last_seq = next_seq,
      head_hash = next_hash,
      updated_at = now()
  where head.run_id = p_run_id;

  insert into excon_private.outbox (event_id, run_id, topic, payload)
  values (
    result_row.event_id,
    p_run_id,
    'excon.run-event.v1',
    jsonb_build_object(
      'eventId', result_row.event_id,
      'runId', result_row.run_id,
      'runSeq', result_row.run_seq,
      'eventType', result_row.event_type
    )
  );

  return result_row;
end;
$$;

create or replace function excon_private.record_run_barrier_input(
  p_barrier_id uuid,
  p_condition_key text,
  p_source_event_id uuid
)
returns public.run_barriers
language plpgsql
security invoker
set search_path = ''
as $$
declare
  barrier_row public.run_barriers%rowtype;
  source_seq bigint;
  source_run uuid;
  current_count integer;
begin
  select * into barrier_row
  from public.run_barriers as barrier
  where barrier.id = p_barrier_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'barrier does not exist';
  end if;
  if barrier_row.state = 'released' then
    raise exception using errcode = '55000', message = 'released barriers are immutable';
  end if;

  select event.run_id, event.run_seq into source_run, source_seq
  from excon_private.run_events as event
  where event.event_id = p_source_event_id;

  if source_run is null or source_run <> barrier_row.run_id then
    raise exception using errcode = '23514', message = 'barrier evidence must belong to the same run';
  end if;

  insert into excon_private.run_barrier_inputs (
    barrier_id,
    run_id,
    condition_key,
    source_event_id,
    source_run_seq
  ) values (
    barrier_row.id,
    barrier_row.run_id,
    p_condition_key,
    p_source_event_id,
    source_seq
  ) on conflict (barrier_id, condition_key, source_event_id) do nothing;

  select least(count(*)::integer, barrier_row.required_count)
    into current_count
  from excon_private.run_barrier_inputs as input
  where input.barrier_id = barrier_row.id;

  update public.run_barriers as barrier
  set input_count = current_count,
      state = case
        when current_count >= barrier.required_count then 'satisfied'
        else barrier.state
      end,
      satisfied_at = case
        when current_count >= barrier.required_count then coalesce(barrier.satisfied_at, now())
        else barrier.satisfied_at
      end,
      lock_version = case
        when current_count <> barrier.input_count then barrier.lock_version + 1
        else barrier.lock_version
      end
  where barrier.id = barrier_row.id
  returning * into barrier_row;

  return barrier_row;
end;
$$;

create or replace function excon_private.release_run_barrier(p_barrier_id uuid)
returns public.run_barriers
language plpgsql
security invoker
set search_path = ''
as $$
declare
  barrier_row public.run_barriers%rowtype;
begin
  select * into barrier_row
  from public.run_barriers as barrier
  where barrier.id = p_barrier_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'barrier does not exist';
  end if;
  if barrier_row.state = 'released' then
    return barrier_row;
  end if;
  if barrier_row.state <> 'satisfied' then
    raise exception using errcode = '55000', message = 'barrier is not satisfied';
  end if;

  update public.run_barriers as barrier
  set state = 'released',
      released_at = now(),
      lock_version = barrier.lock_version + 1
  where barrier.id = p_barrier_id
  returning * into barrier_row;

  return barrier_row;
end;
$$;

create or replace function excon_private.guard_agent_view_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  head_row excon_private.agent_receipt_heads%rowtype;
  disclosure_row public.event_disclosures%rowtype;
  batch_row public.delivery_batches%rowtype;
  issued_event excon_private.run_events%rowtype;
  computed_content_hash text;
  computed_receipt_hash bytea;
begin
  select * into head_row
  from excon_private.agent_receipt_heads as head
  where head.run_agent_id = new.run_agent_id
  for update;

  if not found or head_row.run_id <> new.run_id then
    raise exception using errcode = '23514', message = 'receipt head does not match the run agent';
  end if;

  select * into disclosure_row
  from public.event_disclosures as disclosure
  where disclosure.id = new.disclosure_id;

  select * into batch_row
  from public.delivery_batches as batch
  where batch.id = new.delivery_batch_id
  for update;

  select * into issued_event
  from excon_private.run_events as event
  where event.event_id = new.issued_event_id;

  if disclosure_row.id is null
    or disclosure_row.run_id <> new.run_id
    or disclosure_row.run_agent_id <> new.run_agent_id
    or disclosure_row.source_event_id <> new.source_event_id
    or disclosure_row.source_run_seq <> new.source_run_seq
    or disclosure_row.resource_type <> new.resource_type
    or disclosure_row.resource_id <> new.resource_id
    or disclosure_row.resource_version <> new.resource_version then
    raise exception using errcode = '23514', message = 'receipt does not match its disclosure';
  end if;

  if batch_row.id is null
    or batch_row.run_id <> new.run_id
    or batch_row.run_agent_id <> new.run_agent_id then
    raise exception using errcode = '23514', message = 'receipt does not match its delivery batch';
  end if;

  if issued_event.event_id is null
    or issued_event.run_id <> new.run_id
    or issued_event.run_seq <> new.issued_run_seq
    or batch_row.run_cursor < new.issued_run_seq then
    raise exception using errcode = '23514', message = 'receipt issuance event is invalid';
  end if;

  if new.agent_receipt_seq <> head_row.last_seq + 1
    or new.previous_receipt_hash is distinct from head_row.head_hash then
    raise exception using errcode = '23514', message = 'receipt sequence does not extend the agent chain';
  end if;

  computed_content_hash := encode(
    extensions.digest(convert_to(new.content_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  new.content_hash := computed_content_hash;
  computed_receipt_hash := extensions.digest(
    coalesce(head_row.head_hash, ''::bytea)
    || convert_to(
      concat_ws(
        '|',
        new.run_id::text,
        new.run_agent_id::text,
        new.agent_receipt_seq::text,
        new.delivery_batch_id::text,
        new.disclosure_id::text,
        new.issued_event_id::text,
        new.issued_run_seq::text,
        new.resource_type,
        new.resource_id::text,
        new.resource_version,
        computed_content_hash
      ),
      'UTF8'
    ),
    'sha256'
  );
  new.receipt_hash := computed_receipt_hash;

  update excon_private.agent_receipt_heads as head
  set last_seq = new.agent_receipt_seq,
      head_hash = computed_receipt_hash,
      updated_at = now()
  where head.run_agent_id = new.run_agent_id;

  update public.delivery_batches as batch
  set from_receipt_seq = coalesce(batch.from_receipt_seq, new.agent_receipt_seq),
      through_receipt_seq = new.agent_receipt_seq,
      receipt_head_hash = computed_receipt_hash
  where batch.id = new.delivery_batch_id;

  return new;
end;
$$;

create or replace function excon_private.guard_acknowledgement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  receipt_row public.agent_view_receipts%rowtype;
begin
  select * into receipt_row
  from public.agent_view_receipts as receipt
  where receipt.run_agent_id = new.run_agent_id
    and receipt.agent_receipt_seq = new.through_receipt_seq;

  if receipt_row.id is null
    or receipt_row.run_id <> new.run_id
    or receipt_row.delivery_batch_id <> new.delivery_batch_id
    or receipt_row.receipt_hash <> new.acknowledged_head_hash
    or new.acknowledged_run_seq < receipt_row.issued_run_seq then
    raise exception using
      errcode = '23514',
      message = 'acknowledgement does not match the receipt chain';
  end if;

  return new;
end;
$$;

create or replace function excon_private.guard_artifact_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_artifact uuid;
  parent_run uuid;
  parent_version integer;
begin
  if new.base_version_id is null then
    if new.version_no <> 1 then
      raise exception using errcode = '23514', message = 'first artifact version must be one';
    end if;
    return new;
  end if;

  select v.artifact_id, v.run_id, v.version_no
    into parent_artifact, parent_run, parent_version
  from public.run_artifact_versions as v
  where v.id = new.base_version_id;

  if parent_artifact <> new.artifact_id
    or parent_run <> new.run_id
    or new.version_no <> parent_version + 1 then
    raise exception using errcode = '23514', message = 'artifact base version is invalid';
  end if;
  return new;
end;
$$;

create or replace function excon_private.guard_run_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_run uuid;
  parent_actor uuid;
  parent_type text;
  parent_revision integer;
begin
  if new.revision_of_id is null then
    return new;
  end if;

  select s.run_id, s.actor_run_agent_id, s.submission_type, s.revision_no
    into parent_run, parent_actor, parent_type, parent_revision
  from public.run_submissions as s
  where s.id = new.revision_of_id;

  if parent_run <> new.run_id
    or parent_actor <> new.actor_run_agent_id
    or parent_type <> new.submission_type
    or new.revision_no <> parent_revision + 1 then
    raise exception using errcode = '23514', message = 'submission revision chain is invalid';
  end if;
  return new;
end;
$$;

create or replace function excon_private.guard_feedback_action_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.run_id,
    new.feedback_id,
    new.target_run_agent_id,
    new.target_task_id,
    new.action,
    new.predecessor_submission_id,
    new.evaluation_id,
    new.issued_run_seq,
    new.expires_virtual_at,
    new.expires_at,
    new.max_uses,
    new.scope_hash,
    new.created_at
  ) is distinct from (
    old.run_id,
    old.feedback_id,
    old.target_run_agent_id,
    old.target_task_id,
    old.action,
    old.predecessor_submission_id,
    old.evaluation_id,
    old.issued_run_seq,
    old.expires_virtual_at,
    old.expires_at,
    old.max_uses,
    old.scope_hash,
    old.created_at
  ) then
    raise exception using errcode = '55000', message = 'feedback action grant scope is immutable';
  end if;
  if new.used_count < old.used_count then
    raise exception using errcode = '55000', message = 'feedback grant usage is monotonic';
  end if;
  if old.revoked_run_seq is not null and new.revoked_run_seq <> old.revoked_run_seq then
    raise exception using errcode = '55000', message = 'revoked feedback grants are terminal';
  end if;
  return new;
end;
$$;

-- Triggers ------------------------------------------------------------------

drop trigger scenario_versions_guard on public.scenario_versions;
create trigger scenario_versions_guard
before insert or update or delete on public.scenario_versions
for each row execute function excon_private.guard_scenario_version();

create trigger exercise_runs_guard
before insert or update on public.exercise_runs
for each row execute function excon_private.guard_exercise_run();

create trigger exercise_runs_initialize_event_head
after insert on public.exercise_runs
for each row execute function excon_private.initialize_run_event_head();

create trigger run_agents_initialize_receipt_head
after insert on public.run_agents
for each row execute function excon_private.initialize_agent_receipt_head();

create trigger role_definitions_guard
before insert or update or delete on public.role_definitions
for each row execute function excon_private.guard_role_definition();

create trigger agent_identities_guard
before update on public.agent_identities
for each row execute function excon_private.guard_agent_identity();

create trigger agent_versions_guard
before insert or update or delete on public.agent_versions
for each row execute function excon_private.guard_agent_version();

create trigger run_role_assignments_guard
before insert or update or delete on public.run_role_assignments
for each row execute function excon_private.guard_run_role_assignment();

create trigger run_events_insert_guard
before insert on excon_private.run_events
for each row execute function excon_private.guard_run_event_insert();

create trigger agent_view_receipts_chain_guard
before insert on public.agent_view_receipts
for each row execute function excon_private.guard_agent_view_receipt();

create trigger acknowledgements_chain_guard
before insert on public.acknowledgements
for each row execute function excon_private.guard_acknowledgement();

create trigger run_artifact_versions_chain_guard
before insert on public.run_artifact_versions
for each row execute function excon_private.guard_artifact_version();

create trigger run_submissions_chain_guard
before insert on public.run_submissions
for each row execute function excon_private.guard_run_submission();

create or replace function excon_private.guard_run_message_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_kind text;
  parent_thread_id uuid;
begin
  if new.kind <> 'response' then
    if new.reply_to_message_id is not null or new.thread_id <> new.id then
      raise exception using
        errcode = '23514',
        message = 'root messages must own their thread and cannot reference a parent';
    end if;
    return new;
  end if;

  select parent.kind, parent.thread_id
  into parent_kind, parent_thread_id
  from public.run_messages as parent
  where parent.id = new.reply_to_message_id
    and parent.run_id = new.run_id;

  if parent_kind is distinct from 'request'
    or parent_thread_id is distinct from new.thread_id then
    raise exception using
      errcode = '23514',
      message = 'response messages must inherit an existing request thread';
  end if;

  if not exists (
    select 1
    from public.run_message_recipients as recipient
    where recipient.run_id = new.run_id
      and recipient.message_id = new.reply_to_message_id
      and recipient.recipient_run_agent_id = new.sender_run_agent_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'the responding run agent is not a parent request recipient';
  end if;

  if not exists (
    select 1
    from public.agent_view_receipts as receipt
    where receipt.run_id = new.run_id
      and receipt.run_agent_id = new.sender_run_agent_id
      and receipt.resource_type = 'message'
      and receipt.resource_id = new.reply_to_message_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'the responding run agent has not received the parent request';
  end if;

  return new;
end;
$$;

create trigger run_messages_thread_guard
before insert on public.run_messages
for each row execute function excon_private.guard_run_message_thread();

create or replace function excon_private.guard_run_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.run_messages%rowtype;
  parent_sender_run_agent_id uuid;
  artifact_ref jsonb;
begin
  select * into message_row
  from public.run_messages as message
  where message.id = new.message_id
    and message.run_id = new.run_id;

  if message_row.kind = 'response' then
    select parent.sender_run_agent_id into parent_sender_run_agent_id
    from public.run_messages as parent
    where parent.id = message_row.reply_to_message_id
      and parent.run_id = message_row.run_id;

    if not exists (
      select 1
      from public.run_message_recipients as recipient
      where recipient.message_id = message_row.id
        and recipient.run_id = message_row.run_id
        and recipient.recipient_run_agent_id = parent_sender_run_agent_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'response recipients must include the parent request sender';
    end if;
  end if;

  for artifact_ref in
    select value from jsonb_array_elements(message_row.artifact_version_refs)
  loop
    if not exists (
      select 1
      from public.run_artifact_versions as version
      join public.run_artifact_recipients as artifact_grant
        on artifact_grant.artifact_version_id = version.id
        and artifact_grant.artifact_id = version.artifact_id
        and artifact_grant.run_id = version.run_id
      where version.id = (artifact_ref ->> 'artifactVersionId')::uuid
        and version.artifact_id = (artifact_ref ->> 'artifactId')::uuid
        and version.run_id = message_row.run_id
        and version.content_hash = regexp_replace(
          artifact_ref ->> 'contentHash',
          '^sha256:',
          ''
        )
        and artifact_grant.recipient_run_agent_id = new.recipient_run_agent_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'message recipient lacks the referenced artifact version grant';
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger run_message_recipients_interaction_guard
after insert on public.run_message_recipients
deferrable initially deferred
for each row execute function excon_private.guard_run_message_recipient();

create trigger feedback_action_grants_guard
before update on public.feedback_action_grants
for each row execute function excon_private.guard_feedback_action_grant();

do $immutable_triggers$
declare
  target regclass;
  trigger_stem text;
begin
  foreach target in array array[
    'public.scenario_version_lifecycle_events'::regclass,
    'public.agent_identity_lifecycle_events'::regclass,
    'public.agent_version_lifecycle_events'::regclass,
    'public.run_task_dependencies'::regclass,
    'public.event_disclosures'::regclass,
    'public.agent_view_receipts'::regclass,
    'public.acknowledgements'::regclass,
    'public.run_messages'::regclass,
    'public.run_message_recipients'::regclass,
    'public.run_artifact_versions'::regclass,
    'public.run_artifact_recipients'::regclass,
    'public.run_submissions'::regclass,
    'public.run_submission_contributors'::regclass,
    'public.run_evaluations'::regclass,
    'public.run_feedbacks'::regclass,
    'public.run_feedback_recipients'::regclass,
    'excon_private.run_events'::regclass,
    'excon_private.run_barrier_inputs'::regclass,
    'excon_private.run_evaluation_evidence'::regclass
  ] loop
    trigger_stem := replace(target::text, '.', '_');
    execute format(
      'create trigger %I before update or delete on %s for each row execute function excon_private.reject_immutable_mutation()',
      trigger_stem || '_immutable',
      target
    );
    execute format(
      'create trigger %I before truncate on %s for each statement execute function excon_private.reject_immutable_mutation()',
      trigger_stem || '_no_truncate',
      target
    );
  end loop;
end;
$immutable_triggers$;

-- Query and foreign-key indexes ---------------------------------------------

create index scenario_version_lifecycle_actor_idx
  on public.scenario_version_lifecycle_events (actor_user_id, occurred_at desc);
create index role_definitions_required_idx
  on public.role_definitions (scenario_version_id, ordinal)
  where is_required;
create index scenario_versions_owner_idx
  on public.scenario_versions (owner_user_id, created_at desc);
create index agent_identity_lifecycle_actor_idx
  on public.agent_identity_lifecycle_events (actor_user_id, occurred_at desc);
create index agent_versions_owner_idx
  on public.agent_versions (owner_user_id, created_at desc);
create index agent_version_lifecycle_actor_idx
  on public.agent_version_lifecycle_events (actor_user_id, occurred_at desc);
create index exercise_runs_scenario_state_idx
  on public.exercise_runs (scenario_version_id, state, created_at desc);
create index exercise_runs_created_by_idx
  on public.exercise_runs (created_by, created_at desc);
create index exercise_runs_parent_idx
  on public.exercise_runs (parent_run_id)
  where parent_run_id is not null;
create index run_human_members_user_idx
  on public.run_human_members (user_id, run_id);
create index run_agents_version_idx
  on public.run_agents (agent_version_id, created_at desc);
create index run_agents_owner_idx
  on public.run_agents (owner_user_id, created_at desc);
create index run_agents_team_idx
  on public.run_agents (team_id, run_id)
  where team_id is not null;
create index run_role_assignments_agent_idx
  on public.run_role_assignments (run_agent_id, run_id, assigned_at desc);
create index run_role_assignments_role_idx
  on public.run_role_assignments (role_definition_id, run_id, assigned_at desc);
create index run_tasks_role_idx
  on public.run_tasks (eligible_role_definition_id, run_id)
  where eligible_role_definition_id is not null;
create index run_tasks_claimant_idx
  on public.run_tasks (claimed_by_run_agent_id, run_id)
  where claimed_by_run_agent_id is not null;
create index run_tasks_ready_idx
  on public.run_tasks (run_id, priority desc, available_virtual_at, id)
  where state in ('ready', 'rework_required');
create index run_task_dependencies_run_idx
  on public.run_task_dependencies (run_id, task_id);
create index run_task_dependencies_parent_idx
  on public.run_task_dependencies (depends_on_task_id, run_id);
create index run_events_run_time_idx
  on excon_private.run_events (run_id, occurred_at desc);
create index outbox_run_idx
  on excon_private.outbox (run_id, created_at desc);
create index outbox_claim_idx
  on excon_private.outbox (available_at, id)
  where status = 'pending';
create index run_task_claims_run_agent_idx
  on excon_private.run_task_claims (run_agent_id, run_id, claimed_at desc);
create index run_task_claims_run_idx
  on excon_private.run_task_claims (run_id, claimed_at desc);
create index run_barrier_inputs_event_idx
  on excon_private.run_barrier_inputs (source_event_id, run_id, source_run_seq);
create index agent_receipt_heads_run_idx
  on excon_private.agent_receipt_heads (run_id, run_agent_id);
create index event_disclosures_run_idx
  on public.event_disclosures (run_id, granted_run_seq, id);
create index event_disclosures_source_idx
  on public.event_disclosures (source_event_id, run_id, source_run_seq);
create index event_disclosures_grant_idx
  on public.event_disclosures (granted_event_id, run_id, granted_run_seq);
create index delivery_batches_run_idx
  on public.delivery_batches (run_id, created_at desc);
create index agent_view_receipts_run_idx
  on public.agent_view_receipts (run_id, issued_run_seq, id);
create index agent_view_receipts_batch_idx
  on public.agent_view_receipts (delivery_batch_id, run_id, run_agent_id);
create index agent_view_receipts_disclosure_idx
  on public.agent_view_receipts (disclosure_id, run_id, run_agent_id);
create index agent_view_receipts_source_idx
  on public.agent_view_receipts (source_event_id, run_id, source_run_seq);
create index agent_view_receipts_issued_idx
  on public.agent_view_receipts (issued_event_id, run_id, issued_run_seq);
create index acknowledgements_run_idx
  on public.acknowledgements (run_id, acknowledged_run_seq, id);
create index acknowledgements_batch_idx
  on public.acknowledgements (delivery_batch_id, run_id, run_agent_id);
create index acknowledgements_event_idx
  on public.acknowledgements (acknowledged_event_id, run_id, acknowledged_run_seq);
create index run_messages_run_idx
  on public.run_messages (run_id, sent_at desc);
create index run_messages_sender_idx
  on public.run_messages (sender_run_agent_id, run_id, sent_at desc);
create index run_messages_thread_idx
  on public.run_messages (thread_id, run_id, sent_at);
create index run_messages_reply_idx
  on public.run_messages (reply_to_message_id, run_id)
  where reply_to_message_id is not null;
create index run_message_recipients_agent_idx
  on public.run_message_recipients (recipient_run_agent_id, run_id, created_at desc);
create index run_artifacts_creator_idx
  on public.run_artifacts (created_by_run_agent_id, run_id, created_at desc);
create index run_artifact_versions_base_idx
  on public.run_artifact_versions (base_version_id)
  where base_version_id is not null;
create index run_artifact_versions_author_idx
  on public.run_artifact_versions (author_run_agent_id, run_id, created_at desc);
create index run_artifact_versions_run_idx
  on public.run_artifact_versions (run_id, created_at desc);
create index run_artifact_recipients_agent_idx
  on public.run_artifact_recipients (recipient_run_agent_id, run_id, created_at desc);
create index run_submissions_run_idx
  on public.run_submissions (run_id, submitted_at desc);
create index run_submissions_task_idx
  on public.run_submissions (task_id, run_id, submitted_at desc)
  where task_id is not null;
create index run_submissions_actor_idx
  on public.run_submissions (actor_run_agent_id, run_id, submitted_at desc);
create index run_submissions_role_idx
  on public.run_submissions (role_definition_id)
  where role_definition_id is not null;
create index run_submissions_team_idx
  on public.run_submissions (team_id, run_id)
  where team_id is not null;
create index run_submissions_revision_idx
  on public.run_submissions (revision_of_id)
  where revision_of_id is not null;
create index run_submission_contributors_agent_idx
  on public.run_submission_contributors (run_agent_id, run_id, created_at desc);
create index run_evaluations_run_idx
  on public.run_evaluations (run_id, completed_at desc);
create index run_evaluations_submission_idx
  on public.run_evaluations (submission_id, run_id)
  where submission_id is not null;
create index run_evaluations_task_idx
  on public.run_evaluations (task_id, run_id)
  where task_id is not null;
create index run_evaluation_evidence_run_idx
  on excon_private.run_evaluation_evidence (run_id, created_at desc);
create index run_feedbacks_run_idx
  on public.run_feedbacks (run_id, created_at desc);
create index run_feedbacks_evaluation_idx
  on public.run_feedbacks (evaluation_id, run_id);
create index run_feedback_recipients_agent_idx
  on public.run_feedback_recipients (recipient_run_agent_id, run_id, created_at desc);
create index feedback_action_grants_run_idx
  on public.feedback_action_grants (run_id, created_at desc);
create index feedback_action_grants_feedback_idx
  on public.feedback_action_grants (feedback_id, run_id);
create index feedback_action_grants_agent_idx
  on public.feedback_action_grants (target_run_agent_id, run_id, created_at desc);
create index feedback_action_grants_task_idx
  on public.feedback_action_grants (target_task_id, run_id, created_at desc);
create index feedback_action_grants_predecessor_idx
  on public.feedback_action_grants (predecessor_submission_id)
  where predecessor_submission_id is not null;
create index feedback_action_grants_evaluation_idx
  on public.feedback_action_grants (evaluation_id, run_id);
create index run_agent_credentials_run_idx
  on excon_private.run_agent_credentials (run_id, issued_at desc);
create index run_agent_credentials_rotated_idx
  on excon_private.run_agent_credentials (rotated_from_id)
  where rotated_from_id is not null;
create index run_agent_credentials_creator_idx
  on excon_private.run_agent_credentials (created_by, issued_at desc);
create index telemetry_sessions_run_idx
  on excon_private.telemetry_sessions (run_id, started_at desc);
create index telemetry_sessions_agent_idx
  on excon_private.telemetry_sessions (run_agent_id, run_id, started_at desc);
create index telemetry_sessions_credential_idx
  on excon_private.telemetry_sessions (credential_id, started_at desc);
create index acknowledgements_run_agent_fk_idx
  on public.acknowledgements (run_agent_id, run_id);
create index agent_receipt_heads_run_agent_fk_idx
  on excon_private.agent_receipt_heads (run_agent_id, run_id);
create index agent_versions_identity_owner_fk_idx
  on public.agent_versions (agent_identity_id, owner_user_id);
create index agent_view_receipts_run_agent_fk_idx
  on public.agent_view_receipts (run_agent_id, run_id);
create index delivery_batches_run_agent_fk_idx
  on public.delivery_batches (run_agent_id, run_id);
create index event_disclosures_run_agent_fk_idx
  on public.event_disclosures (run_agent_id, run_id);
create index run_agent_credentials_run_agent_fk_idx
  on excon_private.run_agent_credentials (run_agent_id, run_id);
create index run_agents_version_owner_fk_idx
  on public.run_agents (agent_version_id, owner_user_id);
create index run_artifact_recipients_version_fk_idx
  on public.run_artifact_recipients (artifact_version_id, artifact_id, run_id);
create index run_artifact_versions_artifact_fk_idx
  on public.run_artifact_versions (artifact_id, run_id);
create index run_barrier_inputs_barrier_fk_idx
  on excon_private.run_barrier_inputs (barrier_id, run_id);
create index run_evaluation_evidence_evaluation_fk_idx
  on excon_private.run_evaluation_evidence (evaluation_id, run_id);
create index run_feedback_recipients_feedback_fk_idx
  on public.run_feedback_recipients (feedback_id, run_id);
create index run_message_recipients_message_fk_idx
  on public.run_message_recipients (message_id, run_id);
create index run_submission_contributors_submission_fk_idx
  on public.run_submission_contributors (submission_id, run_id);
create index run_task_claims_task_fk_idx
  on excon_private.run_task_claims (task_id, run_id);
create index run_task_dependencies_task_fk_idx
  on public.run_task_dependencies (task_id, run_id);

-- Data API exposure is explicit and independent from RLS --------------------

alter table public.scenario_version_lifecycle_events enable row level security;
alter table public.role_definitions enable row level security;
alter table public.agent_identities enable row level security;
alter table public.agent_identity_lifecycle_events enable row level security;
alter table public.agent_versions enable row level security;
alter table public.agent_version_lifecycle_events enable row level security;
alter table public.exercise_runs enable row level security;
alter table public.run_human_members enable row level security;
alter table public.run_teams enable row level security;
alter table public.run_agents enable row level security;
alter table public.run_role_assignments enable row level security;
alter table public.run_tasks enable row level security;
alter table public.run_task_dependencies enable row level security;
alter table public.run_barriers enable row level security;
alter table public.event_disclosures enable row level security;
alter table public.delivery_batches enable row level security;
alter table public.agent_view_receipts enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.run_messages enable row level security;
alter table public.run_message_recipients enable row level security;
alter table public.run_artifacts enable row level security;
alter table public.run_artifact_versions enable row level security;
alter table public.run_artifact_recipients enable row level security;
alter table public.run_submissions enable row level security;
alter table public.run_submission_contributors enable row level security;
alter table public.run_evaluations enable row level security;
alter table public.run_feedbacks enable row level security;
alter table public.run_feedback_recipients enable row level security;
alter table public.feedback_action_grants enable row level security;

drop policy scenarios_read_published on public.scenarios;
create policy scenarios_read_catalog
on public.scenarios for select
to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.scenario_versions as version
    where version.scenario_id = scenarios.id
      and version.status = 'published'
  )
);

drop policy scenario_versions_read_available on public.scenario_versions;
create policy scenario_versions_read_catalog
on public.scenario_versions for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or status = 'published'
  or exists (
    select 1
    from public.episodes as episode
    join public.episode_members as member on member.episode_id = episode.id
    where episode.scenario_version_id = scenario_versions.id
      and member.user_id = (select auth.uid())
  )
);

create policy scenario_version_lifecycle_read_catalog
on public.scenario_version_lifecycle_events for select
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions as version
    where version.id = scenario_version_lifecycle_events.scenario_version_id
      and (version.status = 'published' or version.owner_user_id = (select auth.uid()))
  )
);

create policy role_definitions_read_catalog
on public.role_definitions for select
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions as version
    where version.id = role_definitions.scenario_version_id
      and (version.status = 'published' or version.owner_user_id = (select auth.uid()))
  )
);

create policy agent_identities_read_owner
on public.agent_identities for select
to authenticated
using (owner_user_id = (select auth.uid()));

create policy agent_identity_lifecycle_read_owner
on public.agent_identity_lifecycle_events for select
to authenticated
using (
  exists (
    select 1
    from public.agent_identities as identity
    where identity.id = agent_identity_lifecycle_events.agent_identity_id
      and identity.owner_user_id = (select auth.uid())
  )
);

create policy agent_versions_read_owner
on public.agent_versions for select
to authenticated
using (owner_user_id = (select auth.uid()));

create policy agent_version_lifecycle_read_owner
on public.agent_version_lifecycle_events for select
to authenticated
using (
  exists (
    select 1
    from public.agent_versions as version
    where version.id = agent_version_lifecycle_events.agent_version_id
      and version.owner_user_id = (select auth.uid())
  )
);

create policy exercise_runs_read_creator
on public.exercise_runs for select
to authenticated
using (created_by = (select auth.uid()));

do $run_read_policies$
declare
  target regclass;
  policy_name text;
begin
  foreach target in array array[
    'public.run_human_members'::regclass,
    'public.run_teams'::regclass,
    'public.run_agents'::regclass,
    'public.run_role_assignments'::regclass,
    'public.run_tasks'::regclass,
    'public.run_task_dependencies'::regclass,
    'public.run_barriers'::regclass,
    'public.event_disclosures'::regclass,
    'public.delivery_batches'::regclass,
    'public.agent_view_receipts'::regclass,
    'public.acknowledgements'::regclass,
    'public.run_messages'::regclass,
    'public.run_message_recipients'::regclass,
    'public.run_artifacts'::regclass,
    'public.run_artifact_versions'::regclass,
    'public.run_artifact_recipients'::regclass,
    'public.run_submissions'::regclass,
    'public.run_submission_contributors'::regclass,
    'public.run_evaluations'::regclass,
    'public.run_feedbacks'::regclass,
    'public.run_feedback_recipients'::regclass,
    'public.feedback_action_grants'::regclass
  ] loop
    policy_name := replace(target::text, '.', '_') || '_read_run_creator';
    execute format(
      'create policy %I on %s for select to authenticated using (exists (select 1 from public.exercise_runs as run where run.id = run_id and run.created_by = (select auth.uid())))',
      policy_name,
      target
    );
  end loop;
end;
$run_read_policies$;

do $private_rls$
declare
  target regclass;
begin
  for target in
    select c.oid::regclass
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'excon_private'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %s enable row level security', target);
    execute format('alter table %s force row level security', target);
  end loop;
end;
$private_rls$;

revoke all on table
  public.scenario_version_lifecycle_events,
  public.role_definitions,
  public.agent_identities,
  public.agent_identity_lifecycle_events,
  public.agent_versions,
  public.agent_version_lifecycle_events,
  public.exercise_runs,
  public.run_human_members,
  public.run_teams,
  public.run_agents,
  public.run_role_assignments,
  public.run_tasks,
  public.run_task_dependencies,
  public.run_barriers,
  public.event_disclosures,
  public.delivery_batches,
  public.agent_view_receipts,
  public.acknowledgements,
  public.run_messages,
  public.run_message_recipients,
  public.run_artifacts,
  public.run_artifact_versions,
  public.run_artifact_recipients,
  public.run_submissions,
  public.run_submission_contributors,
  public.run_evaluations,
  public.run_feedbacks,
  public.run_feedback_recipients,
  public.feedback_action_grants
from anon, authenticated;

grant select on table
  public.scenario_version_lifecycle_events,
  public.role_definitions,
  public.agent_identities,
  public.agent_identity_lifecycle_events,
  public.agent_versions,
  public.agent_version_lifecycle_events,
  public.exercise_runs,
  public.run_human_members,
  public.run_teams,
  public.run_agents,
  public.run_role_assignments,
  public.run_tasks,
  public.run_task_dependencies,
  public.run_barriers,
  public.event_disclosures,
  public.delivery_batches,
  public.agent_view_receipts,
  public.acknowledgements,
  public.run_messages,
  public.run_message_recipients,
  public.run_artifacts,
  public.run_artifact_versions,
  public.run_artifact_recipients,
  public.run_submissions,
  public.run_submission_contributors,
  public.run_evaluations,
  public.run_feedbacks,
  public.run_feedback_recipients,
  public.feedback_action_grants
to authenticated;

revoke all on all tables in schema excon_private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema excon_private
  from public, anon, authenticated, service_role;
revoke execute on all functions in schema excon_private
  from public, anon, authenticated, service_role;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema excon_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema excon_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema excon_private
  revoke execute on functions from public, anon, authenticated, service_role;
