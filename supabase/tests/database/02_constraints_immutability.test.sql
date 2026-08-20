begin;

select plan(23);

insert into public.episodes (
  id,
  scenario_version_id,
  participant_version_id,
  state,
  virtual_time,
  completed_at
)
values (
  'd0000000-0000-4000-8000-000000000010',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'completed',
  '2023-03-23T03:10:00Z',
  now()
);

insert into public.episodes (
  id,
  scenario_version_id,
  participant_version_id,
  state,
  virtual_time
)
values (
  'd0000000-0000-4000-8000-000000000020',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'waiting_for_submission',
  '2023-03-22T07:10:00Z'
);

select lives_ok(
  $$update public.episodes
    set state = 'evaluation_queued'
    where id = 'd0000000-0000-4000-8000-000000000020'$$,
  'a valid submission can queue deterministic evaluation'
);

select lives_ok(
  $$update public.episodes
    set state = 'evaluating'
    where id = 'd0000000-0000-4000-8000-000000000020'$$,
  'a worker can start a queued evaluation'
);

insert into public.episodes (
  id,
  scenario_version_id,
  participant_version_id,
  state,
  virtual_time
)
values (
  'd0000000-0000-4000-8000-000000000021',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'feedback_available',
  '2023-03-22T07:10:00Z'
);

select lives_ok(
  $$update public.episodes
    set state = 'waiting_for_submission'
    where id = 'd0000000-0000-4000-8000-000000000021'$$,
  'feedback can reopen the same checkpoint for an immutable revision'
);

select throws_ok(
  $$update public.episodes
    set state = 'cancelled', completed_at = null
    where id = 'd0000000-0000-4000-8000-000000000010'$$,
  '22023'::char(5),
  'invalid episode transition: completed -> cancelled',
  'completed episodes are terminal'
);

select throws_ok(
  $$
    insert into public.observations (
      id,
      episode_id,
      inject_id,
      recipient_user_id,
      released_virtual_at,
      accessed_virtual_at,
      payload_snapshot,
      payload_hash
    ) values (
      'd0000000-0000-4000-8000-000000000011',
      '50000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      '2023-03-22T07:00:00Z',
      '2023-03-22T07:00:00Z',
      '{}'::jsonb,
      repeat('2', 64)
    )
  $$,
  '23514'::char(5),
  'inject must be released before observation',
  'pending injects cannot be observed'
);

select throws_ok(
  $$
    insert into public.submissions (
      id,
      episode_id,
      participant_version_id,
      actor_user_id,
      revision_no,
      submission_type,
      submitted_virtual_at,
      payload,
      payload_hash,
      idempotency_key
    ) values (
      'd0000000-0000-4000-8000-000000000012',
      '50000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      1,
      'allocation_plan',
      '2023-03-22T07:01:00Z',
      '{}'::jsonb,
      repeat('3', 64),
      'client-time-spoof-0001'
    )
  $$,
  '23514'::char(5),
  'submission virtual time must match the episode clock',
  'clients cannot spoof submission virtual time'
);

select throws_ok(
  $$
    insert into excon_private.information_items (
      scenario_version_id,
      batch_key,
      system_component,
      information_type,
      is_synthetic,
      source_ref,
      event_time,
      observed_time,
      ingested_time,
      release_virtual_at,
      payload,
      payload_hash
    ) values (
      '30000000-0000-4000-8000-000000000001',
      'invalid-time-order',
      'yongding-river-basin',
      'water_availability',
      true,
      'pgtap-invalid-time-order',
      '2023-03-22T08:00:00Z',
      '2023-03-22T07:00:00Z',
      '2023-03-22T09:00:00Z',
      '2023-03-22T10:00:00Z',
      '{}'::jsonb,
      repeat('e', 64)
    )
  $$,
  '23514'::char(5),
  null,
  'information provenance rejects time travel'
);

select throws_ok(
  $$update public.scenario_versions
    set public_manifest = '{"tampered":true}'::jsonb
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'published scenario version content is immutable',
  'published scenario content cannot change'
);

select throws_ok(
  $$delete from public.scenario_versions
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'published scenario versions are immutable',
  'published scenario versions cannot be deleted'
);

select throws_ok(
  $$update public.episodes
    set virtual_time = '2023-03-22T07:09:00Z'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '22023'::char(5),
  'episode virtual time cannot move backwards',
  'episode virtual time is monotonic'
);

select throws_ok(
  $$update public.episodes
    set state = 'running'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '22023'::char(5),
  'invalid episode transition: evaluating -> running',
  'illegal episode transitions are rejected'
);

select throws_ok(
  $$update public.episodes
    set participant_version_id = '40000000-0000-4000-8000-000000000002'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'episode version bindings are immutable',
  'episode participant version is pinned'
);

select throws_ok(
  $$
    insert into public.allocation_items (
      id,
      allocation_plan_id,
      actor_user_id,
      source_code,
      target_code,
      water_source_type,
      purpose,
      starts_at,
      ends_at,
      volume_m3,
      max_flow_m3_s
    ) values (
      'd0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'reclaimed-water-plant',
      'yongding-river-ecological-corridor',
      'reclaimed_water',
      'ecological_replenishment',
      '2023-03-22T06:00:00Z',
      '2023-03-22T08:00:00Z',
      500000,
      2
    )
  $$,
  '23514'::char(5),
  'allocation item must stay within its plan window',
  'allocation items cannot escape the plan window'
);

select throws_ok(
  $$update public.observations
    set payload_snapshot = '{}'::jsonb
    where id = '80000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'public.observations is append-only',
  'observations are immutable'
);

select throws_ok(
  $$delete from public.observations
    where id = '80000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'public.observations is append-only',
  'observations cannot be deleted'
);

select throws_ok(
  $$update public.submissions
    set payload = '{}'::jsonb
    where id = '90000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'public.submissions is append-only',
  'submissions are immutable'
);

select throws_ok(
  $$update public.allocation_plans
    set total_volume_m3 = 1
    where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'public.allocation_plans is append-only',
  'allocation plans are immutable'
);

select throws_ok(
  $$update excon_private.water_system_outcomes
    set metric_value = 0
    where id = 'c0000000-0000-4000-8000-000000000001'$$,
  '55000'::char(5),
  'excon_private.water_system_outcomes is append-only',
  'hidden outcomes are immutable'
);

select throws_ok(
  $$delete from excon_private.episode_events
    where episode_id = '50000000-0000-4000-8000-000000000001' and seq_no = 1$$,
  '55000'::char(5),
  'excon_private.episode_events is append-only',
  'episode events cannot be deleted'
);

select throws_ok(
  $$
    insert into excon_private.episode_events (
      episode_id,
      seq_no,
      event_type,
      audience,
      virtual_time,
      previous_hash,
      event_hash
    ) values (
      '50000000-0000-4000-8000-000000000001',
      2,
      'invalid_hash_chain',
      'internal',
      '2023-03-22T07:10:00Z',
      null,
      decode(repeat('22', 32), 'hex')
    )
  $$,
  '23514'::char(5),
  null,
  'non-first events require a previous hash'
);

select lives_ok(
  $$
    insert into public.submissions (
      id,
      episode_id,
      participant_version_id,
      actor_user_id,
      revision_no,
      revision_of,
      submission_type,
      is_final,
      submitted_virtual_at,
      payload,
      payload_hash,
      idempotency_key
    ) values (
      'd0000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      2,
      '90000000-0000-4000-8000-000000000001',
      'allocation_plan',
      true,
      '2023-03-22T07:10:00Z',
      '{}'::jsonb,
      repeat('e', 64),
      'final-revision-0002'
    )
  $$,
  'a consecutive final revision is accepted'
);

select throws_ok(
  $$
    insert into public.submissions (
      id,
      episode_id,
      participant_version_id,
      actor_user_id,
      revision_no,
      revision_of,
      submission_type,
      is_final,
      submitted_virtual_at,
      payload,
      payload_hash,
      idempotency_key
    ) values (
      'd0000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      3,
      'd0000000-0000-4000-8000-000000000002',
      'allocation_plan',
      true,
      '2023-03-22T07:10:00Z',
      '{}'::jsonb,
      repeat('f', 64),
      'final-revision-0003'
    )
  $$,
  '23505'::char(5),
  null,
  'an episode can have only one final submission'
);

select throws_ok(
  $$
    insert into public.submissions (
      id,
      episode_id,
      participant_version_id,
      actor_user_id,
      revision_no,
      revision_of,
      submission_type,
      submitted_virtual_at,
      payload,
      payload_hash,
      idempotency_key
    ) values (
      'd0000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      4,
      '90000000-0000-4000-8000-000000000001',
      'allocation_plan',
      '2023-03-22T07:10:00Z',
      '{}'::jsonb,
      repeat('1', 64),
      'invalid-revision-0004'
    )
  $$,
  '23514'::char(5),
  'submission revisions must be consecutive within one episode',
  'submission revisions cannot skip numbers'
);

select * from finish();
rollback;
