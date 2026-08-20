begin;

select plan(63);

select has_table('public', 'role_definitions', 'v2 role definitions exist');
select has_table('public', 'agent_identities', 'v2 agent identities exist');
select has_table('public', 'agent_versions', 'v2 agent versions exist');
select has_table('public', 'exercise_runs', 'v2 exercise runs exist');
select has_table('public', 'run_agents', 'v2 run agents exist');
select has_table('public', 'run_role_assignments', 'v2 role assignments exist');
select has_table('public', 'run_tasks', 'v2 run tasks exist');
select has_table('public', 'run_barriers', 'v2 barriers exist');
select has_table('public', 'event_disclosures', 'v2 disclosures exist');
select has_table('public', 'delivery_batches', 'v2 delivery batches exist');
select has_table('public', 'agent_view_receipts', 'v2 view receipts exist');
select has_table('public', 'acknowledgements', 'v2 acknowledgements exist');
select has_table('public', 'run_messages', 'v2 messages exist');
select has_table('public', 'run_artifacts', 'v2 artifacts exist');
select has_table('public', 'run_artifact_versions', 'v2 artifact versions exist');
select has_table('public', 'run_submissions', 'v2 submissions exist');
select has_table('public', 'run_evaluations', 'v2 safe evaluations exist');
select has_table('public', 'run_feedbacks', 'v2 feedback exists');
select has_table('public', 'feedback_action_grants', 'v2 feedback action grants exist');
select has_table('excon_private', 'run_event_heads', 'v2 run event heads exist');
select has_table('excon_private', 'run_events', 'v2 run events exist');
select has_table('excon_private', 'outbox', 'v2 transactional outbox exists');
select has_table('excon_private', 'run_evaluation_evidence', 'private evaluation evidence exists');
select has_table('excon_private', 'run_agent_credentials', 'private run-agent credentials exist');
select has_table('excon_private', 'telemetry_sessions', 'private telemetry sessions exist');

select has_function(
  'excon_private',
  'claim_run_task',
  array['uuid', 'uuid', 'bigint', 'bytea', 'interval'],
  'atomic run task claim function exists'
);
select has_function(
  'excon_private',
  'append_run_event',
  array['uuid', 'text', 'text', 'uuid', 'text', 'uuid', 'text', 'uuid', 'text', 'timestamptz', 'jsonb', 'uuid', 'uuid', 'text', 'text'],
  'serialized run event append function exists'
);

select is(
  (
    select count(*)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname in (
        'scenario_version_lifecycle_events',
        'role_definitions',
        'agent_identities',
        'agent_identity_lifecycle_events',
        'agent_versions',
        'agent_version_lifecycle_events',
        'exercise_runs',
        'run_human_members',
        'run_teams',
        'run_agents',
        'run_role_assignments',
        'run_tasks',
        'run_task_dependencies',
        'run_barriers',
        'event_disclosures',
        'delivery_batches',
        'agent_view_receipts',
        'acknowledgements',
        'run_messages',
        'run_message_recipients',
        'run_artifacts',
        'run_artifact_versions',
        'run_artifact_recipients',
        'run_submissions',
        'run_submission_contributors',
        'run_evaluations',
        'run_feedbacks',
        'run_feedback_recipients',
        'feedback_action_grants'
      )
      and c.relrowsecurity
  ),
  29::bigint,
  'every exposed v2 table has RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'excon_private'
      and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ),
  'every private table has RLS enabled and forced as defense in depth'
);

select is(
  (
    select count(*)
    from unnest(array[
      'scenario_version_lifecycle_events', 'role_definitions',
      'agent_identities', 'agent_identity_lifecycle_events',
      'agent_versions', 'agent_version_lifecycle_events', 'exercise_runs',
      'run_human_members', 'run_teams', 'run_agents', 'run_role_assignments',
      'run_tasks', 'run_task_dependencies', 'run_barriers',
      'event_disclosures', 'delivery_batches', 'agent_view_receipts',
      'acknowledgements', 'run_messages', 'run_message_recipients',
      'run_artifacts', 'run_artifact_versions', 'run_artifact_recipients',
      'run_submissions', 'run_submission_contributors', 'run_evaluations',
      'run_feedbacks', 'run_feedback_recipients', 'feedback_action_grants'
    ]) as exposed(table_name)
    where has_table_privilege(
      'authenticated',
      format('public.%I', exposed.table_name),
      'insert'
    )
      or has_table_privilege(
        'authenticated',
        format('public.%I', exposed.table_name),
        'update'
      )
      or has_table_privilege(
        'authenticated',
        format('public.%I', exposed.table_name),
        'delete'
      )
  ),
  0::bigint,
  'no exposed v2 table grants direct Data API writes'
);

select ok(
  has_table_privilege('authenticated', 'public.exercise_runs', 'select'),
  'authenticated operators have an explicit run SELECT grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.exercise_runs', 'insert'),
  'Data API clients have no direct run write grant'
);
select ok(
  not has_table_privilege('anon', 'public.exercise_runs', 'select'),
  'anonymous clients cannot list runs'
);
select ok(
  not has_schema_privilege('authenticated', 'excon_private', 'usage'),
  'Data API clients cannot enter the private event schema'
);

select is(
  (
    select min_distinct_required_agents
    from public.scenario_versions
    where id = '30000000-0000-4000-8000-000000000002'
  ),
  4,
  'the Yongding v2 scenario requires four distinct agent instances'
);
select is(
  (
    select count(*)
    from public.role_definitions
    where scenario_version_id = '30000000-0000-4000-8000-000000000002'
      and is_required
  ),
  4::bigint,
  'the Yongding v2 scenario publishes four required roles'
);
select is(
  (
    select count(distinct run_agent_id)
    from public.run_role_assignments
    where run_id = '51000000-0000-4000-8000-000000000001'
      and counts_toward_quorum
      and released_at is null
  ),
  4::bigint,
  'the seeded ready run is staffed by four distinct instances'
);

select throws_ok(
  $$insert into public.scenario_versions (
      id, scenario_id, owner_user_id, version_no, status, public_manifest,
      replay_start_at, replay_end_at, content_hash, published_at
    ) values (
      '30000000-0000-4000-8000-0000000000f0',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      99,
      'published',
      '{}'::jsonb,
      '2023-03-22T07:00:00Z',
      '2023-06-15T08:00:00Z',
      repeat('9', 64),
      now()
    )$$,
  '23514'::char(5),
  'scenario versions must begin as drafts',
  'scenario versions cannot bypass the draft lifecycle'
);
select throws_ok(
  $$insert into public.role_definitions (
      scenario_version_id, role_key, title_i18n
    ) values (
      '30000000-0000-4000-8000-000000000002',
      'late_required_role',
      '{"zh-CN":"迟到角色","en":"Late Role"}'::jsonb
    )$$,
  '55000'::char(5),
  'published role definitions are immutable',
  'published scenario versions cannot gain late role definitions'
);
select throws_ok(
  $$update public.role_definitions
      set role_key = 'tampered-role'
    where id = '31000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'published role definitions are immutable',
  'published role definitions cannot be edited'
);
select throws_ok(
  $$update public.agent_versions
      set model_ref = 'tampered-model'
    where id = '42000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'published agent versions are immutable',
  'published agent versions cannot be edited'
);
select throws_ok(
  $$update public.agent_identities
      set lifecycle_state = 'active'
    where id = '41000000-0000-4000-8000-000000000005'
      and lifecycle_state = 'revoked'$$,
  '55000'::char(5),
  'revoked agent identities are terminal',
  'revoked agent identities cannot be restored'
);

insert into public.exercise_runs (
  id,
  scenario_version_id,
  created_by,
  state,
  virtual_time
)
values (
  '51000000-0000-4000-8000-0000000000f0',
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'forming',
  '2023-03-22T07:00:00Z'
);

insert into public.run_agents (
  id,
  run_id,
  agent_version_id,
  owner_user_id,
  instance_key,
  state,
  joined_at
)
values (
  '53000000-0000-4000-8000-0000000000f0',
  '51000000-0000-4000-8000-0000000000f0',
  '42000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'duplicate-staffing-test',
  'ready',
  now()
);

insert into public.run_role_assignments (
  id,
  run_id,
  run_agent_id,
  role_definition_id,
  slot_no,
  assignment_kind,
  counts_toward_quorum
)
values (
  '54000000-0000-4000-8000-0000000000f0',
  '51000000-0000-4000-8000-0000000000f0',
  '53000000-0000-4000-8000-0000000000f0',
  '31000000-0000-4000-8000-000000000001',
  1,
  'primary',
  true
);

select throws_ok(
  $$insert into public.run_role_assignments (
      id, run_id, run_agent_id, role_definition_id, slot_no,
      assignment_kind, counts_toward_quorum
    ) values (
      '54000000-0000-4000-8000-0000000000f1',
      '51000000-0000-4000-8000-0000000000f0',
      '53000000-0000-4000-8000-0000000000f0',
      '31000000-0000-4000-8000-000000000002',
      1, 'primary', true
    )$$,
  '23505'::char(5),
  null,
  'one instance cannot count twice toward required-role quorum'
);
select throws_ok(
  $$update public.exercise_runs
      set state = 'ready'
    where id = '51000000-0000-4000-8000-0000000000f0'$$,
  '23514'::char(5),
  'run does not satisfy required-role staffing',
  'a run cannot become ready with missing required roles'
);

select is(
  (
    select state
    from excon_private.claim_run_task(
      '55000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      0,
      decode(repeat('81', 32), 'hex'),
      interval '2 minutes'
    )
  ),
  'claimed',
  'an eligible role agent atomically claims its ready task'
);
select is(
  (
    select claim_epoch
    from public.run_tasks
    where id = '55000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the first task claim receives fencing epoch one'
);
select throws_ok(
  $$select * from excon_private.claim_run_task(
      '55000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      0,
      decode(repeat('82', 32), 'hex'),
      interval '2 minutes'
    )$$,
  '40001'::char(5),
  'task version conflict',
  'stale task claims are fenced by lock version'
);
select is(
  (
    select count(*)
    from excon_private.run_task_claims
    where task_id = '55000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a rejected duplicate claim leaves one claim record'
);

select is(
  (
    select run_seq
    from excon_private.append_run_event(
      '51000000-0000-4000-8000-000000000001',
      'test.first',
      'run',
      '51000000-0000-4000-8000-000000000001',
      'system',
      null,
      'platform_observed',
      null,
      'test',
      '2023-03-22T07:01:00Z',
      '{"step":1}'::jsonb
    )
  ),
  2::bigint,
  'the event appender allocates the next run sequence'
);
select is(
  (
    select run_seq
    from excon_private.append_run_event(
      '51000000-0000-4000-8000-000000000001',
      'test.second',
      'run',
      '51000000-0000-4000-8000-000000000001',
      'system',
      null,
      'platform_observed',
      null,
      'test',
      '2023-03-22T07:02:00Z',
      '{"step":2}'::jsonb
    )
  ),
  3::bigint,
  'consecutive appends serialize to consecutive run sequences'
);
select is(
  (
    select last_seq
    from excon_private.run_event_heads
    where run_id = '51000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'the event head advances with the event stream'
);
select is(
  (
    select count(*)
    from excon_private.outbox
    where run_id = '51000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'each authoritative event has a transactional outbox record'
);
select throws_ok(
  $$update excon_private.run_events
      set payload = '{}'::jsonb
    where event_id = '57000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'excon_private.run_events is append-only',
  'authoritative run events are immutable'
);

insert into public.run_barriers (
  id,
  run_id,
  barrier_key,
  barrier_type,
  required_count,
  state
)
values (
  '56000000-0000-4000-8000-0000000000f0',
  '51000000-0000-4000-8000-000000000001',
  'pgtap-two-inputs',
  'quorum',
  2,
  'closed'
);

select is(
  (
    select state
    from excon_private.record_run_barrier_input(
      '56000000-0000-4000-8000-0000000000f0',
      'input-a',
      (
        select event_id
        from excon_private.run_events
        where run_id = '51000000-0000-4000-8000-000000000001'
          and run_seq = 2
      )
    )
  ),
  'closed',
  'one input does not satisfy a two-input barrier'
);
select is(
  (
    select input_count
    from excon_private.record_run_barrier_input(
      '56000000-0000-4000-8000-0000000000f0',
      'input-a',
      (
        select event_id
        from excon_private.run_events
        where run_id = '51000000-0000-4000-8000-000000000001'
          and run_seq = 2
      )
    )
  ),
  1,
  'duplicate barrier evidence is idempotent'
);
select is(
  (
    select state
    from excon_private.record_run_barrier_input(
      '56000000-0000-4000-8000-0000000000f0',
      'input-b',
      (
        select event_id
        from excon_private.run_events
        where run_id = '51000000-0000-4000-8000-000000000001'
          and run_seq = 3
      )
    )
  ),
  'satisfied',
  'distinct evidence satisfies the barrier quorum'
);
select is(
  (
    select state
    from excon_private.release_run_barrier(
      '56000000-0000-4000-8000-0000000000f0'
    )
  ),
  'released',
  'a satisfied barrier releases exactly once'
);

select throws_ok(
  $$update public.agent_view_receipts
      set content_snapshot = '{}'::jsonb
    where id = '5a000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'public.agent_view_receipts is append-only',
  'issued receipts are immutable'
);
select throws_ok(
  $$insert into public.acknowledgements (
      id, run_id, run_agent_id, delivery_batch_id,
      through_receipt_seq, acknowledged_head_hash,
      acknowledged_event_id, acknowledged_run_seq, acknowledged_at
    ) values (
      '5b000000-0000-4000-8000-0000000000f0',
      '51000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      '59000000-0000-4000-8000-000000000001',
      1,
      decode(repeat('ff', 32), 'hex'),
      '57000000-0000-4000-8000-000000000001',
      1,
      now()
    )$$,
  '23514'::char(5),
  'acknowledgement does not match the receipt chain',
  'a forged receipt head cannot be acknowledged'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select is(
  (select count(*) from public.exercise_runs),
  1::bigint,
  'the operator can read its own v2 run'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  (select count(*) from public.exercise_runs),
  0::bigint,
  'an external agent owner cannot bypass the protocol API to list runs'
);
select is(
  (select count(*) from public.agent_view_receipts),
  0::bigint,
  'an external agent owner cannot read receipts through the Data API'
);
select throws_ok(
  $$insert into public.run_messages (
      run_id, sender_run_agent_id, audience, body, body_hash
    ) values (
      '51000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000002',
      'team',
      '{}'::jsonb,
      repeat('1', 64)
    )$$,
  '42501'::char(5),
  null,
  'external agents have no direct Data API message write grant'
);

reset role;

select * from finish();
rollback;
