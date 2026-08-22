begin;

select plan(55);

select has_table(
  'excon_private',
  'v2_command_intents',
  'private v2 command intents exist'
);
select has_table(
  'excon_private',
  'v2_command_outcomes',
  'private v2 command outcomes exist'
);
select has_column(
  'excon_private',
  'v2_command_intents',
  'journal_version',
  'intents retain the journal envelope version'
);
select has_column(
  'excon_private',
  'v2_command_intents',
  'request_hash',
  'intents retain a canonical request hash'
);
select has_column(
  'excon_private',
  'v2_command_intents',
  'lease_key_id',
  'intents retain only the lease HMAC key id'
);
select has_column(
  'excon_private',
  'v2_command_outcomes',
  'generated_ids',
  'outcomes retain deterministic generated ids'
);
select has_column(
  'excon_private',
  'v2_command_outcomes',
  'generated_timestamps',
  'outcomes retain deterministic timestamps'
);
select has_column(
  'excon_private',
  'v2_command_outcomes',
  'lease_counter_count',
  'outcomes retain only the HMAC derivation count'
);

select ok(
  (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'excon_private'
      and c.relname = 'v2_command_intents'
  ),
  'intent journal has forced RLS'
);
select ok(
  (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'excon_private'
      and c.relname = 'v2_command_outcomes'
  ),
  'outcome journal has forced RLS'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'excon_private'
      and tablename in ('v2_command_intents', 'v2_command_outcomes')
  ),
  4::bigint,
  'the journal exposes only explicit runtime read and append policies'
);

select ok(
  not has_table_privilege(
    'anon',
    'excon_private.v2_command_intents',
    'select'
  ),
  'anonymous clients cannot read intents'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'excon_private.v2_command_intents',
    'insert'
  ),
  'authenticated clients cannot insert intents'
);
select ok(
  not has_table_privilege(
    'anon',
    'excon_private.v2_command_outcomes',
    'select'
  ),
  'anonymous clients cannot read outcomes'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'excon_private.v2_command_outcomes',
    'insert'
  ),
  'authenticated clients cannot insert outcomes'
);
select ok(
  not has_sequence_privilege(
    'anon',
    'excon_private.v2_command_intents_intent_seq_seq',
    'usage'
  ),
  'anonymous clients cannot use the intent sequence'
);
select ok(
  not has_sequence_privilege(
    'authenticated',
    'excon_private.v2_command_outcomes_outcome_seq_seq',
    'usage'
  ),
  'authenticated clients cannot use the outcome sequence'
);

select ok(
  exists (
    select 1
    from pg_roles
    where rolname = 'wiser_excon_runtime'
      and not rolsuper
      and not rolbypassrls
      and not rolcanlogin
  ),
  'the runtime group is non-superuser, non-bypassrls, and cannot log in'
);
select ok(
  exists (
    select 1
    from pg_roles
    where rolname = 'wiser_excon_api'
      and not rolsuper
      and not rolbypassrls
      and rolcanlogin
  ),
  'the API runtime role is non-superuser and cannot bypass RLS'
);
select ok(
  pg_has_role('wiser_excon_api', 'wiser_excon_runtime', 'member'),
  'the API runtime role is a member of the journal runtime group'
);
select ok(
  has_schema_privilege('wiser_excon_api', 'excon_private', 'usage'),
  'the API runtime can address the private journal schema'
);
select ok(
  has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents',
    'select'
  ),
  'the API runtime can read intents'
);
select ok(
  has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents',
    'insert'
  ),
  'the API runtime can append intents'
);
select ok(
  has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes',
    'select'
  ),
  'the API runtime can read outcomes'
);
select ok(
  has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes',
    'insert'
  ),
  'the API runtime can append outcomes'
);
select ok(
  has_sequence_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents_intent_seq_seq',
    'usage'
  ),
  'the API runtime can allocate intent sequences'
);
select ok(
  has_sequence_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes_outcome_seq_seq',
    'usage'
  ),
  'the API runtime can allocate outcome sequences'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents',
    'update'
  ),
  'the API runtime cannot update intents'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents',
    'delete'
  ),
  'the API runtime cannot delete intents'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_intents',
    'truncate'
  ),
  'the API runtime cannot truncate intents'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes',
    'update'
  ),
  'the API runtime cannot update outcomes'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes',
    'delete'
  ),
  'the API runtime cannot delete outcomes'
);
select ok(
  not has_table_privilege(
    'wiser_excon_api',
    'excon_private.v2_command_outcomes',
    'truncate'
  ),
  'the API runtime cannot truncate outcomes'
);

insert into excon_private.v2_command_intents (
  intent_id,
  command_name,
  request_hash,
  principal,
  arguments,
  lease_key_id
) values (
  '82000000-0000-4000-8000-000000000001',
  'createScenario',
  'sha256:' || repeat('a', 64),
  '{"id":"operator","participantVersionIds":[]}'::jsonb,
  '["idempotency-key",{"slug":"fixture"}]'::jsonb,
  'local-v1'
);

insert into excon_private.v2_command_outcomes (
  intent_id,
  outcome_status,
  result_hash,
  generated_ids,
  generated_timestamps,
  lease_counter_count
) values (
  '82000000-0000-4000-8000-000000000001',
  'succeeded',
  'sha256:' || repeat('b', 64),
  '["82000000-0000-4000-8000-000000000002"]'::jsonb,
  '["2026-08-22T00:00:00.000Z"]'::jsonb,
  0
);

select is(
  (
    select count(*)
    from excon_private.v2_command_intents
    where intent_id = '82000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'an intent is appendable'
);
select is(
  (
    select count(*)
    from excon_private.v2_command_outcomes
    where intent_id = '82000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'an outcome is appendable'
);
select throws_ok(
  $$update excon_private.v2_command_intents
    set command_name = 'tampered'$$,
  '55000'::char(5),
  null,
  'intent facts cannot be updated by their owner'
);
select throws_ok(
  $$delete from excon_private.v2_command_intents$$,
  '55000'::char(5),
  null,
  'intent facts cannot be deleted by their owner'
);
select throws_ok(
  $$update excon_private.v2_command_outcomes
    set result_hash = 'sha256:' || repeat('c', 64)$$,
  '55000'::char(5),
  null,
  'outcome facts cannot be updated by their owner'
);
select throws_ok(
  $$delete from excon_private.v2_command_outcomes$$,
  '55000'::char(5),
  null,
  'outcome facts cannot be deleted by their owner'
);
select throws_ok(
  $$insert into excon_private.v2_command_intents (
      intent_id, command_name, request_hash, principal, arguments, lease_key_id
    ) values (
      '82000000-0000-4000-8000-000000000010',
      'beginTask',
      'sha256:' || repeat('d', 64),
      '{"id":"operator","participantVersionIds":[]}'::jsonb,
      '["agent","task","key",{"leaseToken":"wlt_plaintext"}]'::jsonb,
      'local-v1'
    )$$,
  '23514'::char(5),
  null,
  'the reserved lease-token argument requires a structured hash reference'
);
select throws_ok(
  $$insert into excon_private.v2_command_intents (
      intent_id, command_name, request_hash, principal, arguments, lease_key_id
    ) values (
      '82000000-0000-4000-8000-000000000012',
      'submitTask',
      'sha256:' || repeat('d', 64),
      '{"id":"operator","participantVersionIds":[]}'::jsonb,
      '["agent","task","key",{"leaseToken":{"$secretRef":{"kind":"lease-token-hash","tokenHash":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},"plaintext":"wlt_forbidden"}}]'::jsonb,
      'local-v1'
    )$$,
  '23514'::char(5),
  null,
  'the reserved lease-token wrapper cannot carry extra plaintext fields'
);
select lives_ok(
  $$insert into excon_private.v2_command_intents (
      intent_id, command_name, request_hash, principal, arguments, lease_key_id
    ) values (
      '82000000-0000-4000-8000-000000000011',
      'createArtifact',
      'sha256:' || repeat('e', 64),
      '{"id":"operator","participantVersionIds":[]}'::jsonb,
      '["agent","run","key",{"content":{"$secretRef":{"kind":"business"},"note":"Bearer and wlt_ are legitimate text"}}]'::jsonb,
      'local-v1'
    )$$,
  'business JSON and token-shaped text do not trip whole-document filters'
);
select throws_ok(
  $$insert into excon_private.v2_command_outcomes (
      intent_id, outcome_status, result_hash, generated_ids,
      generated_timestamps, lease_counter_count
    ) values (
      '82000000-0000-4000-8000-000000000099',
      'succeeded',
      'sha256:' || repeat('f', 64),
      '[]'::jsonb,
      '[]'::jsonb,
      0
    )$$,
  '23503'::char(5),
  null,
  'outcomes require an existing intent'
);
select ok(
  not has_function_privilege(
    'public',
    'excon_private.reject_v2_journal_mutation()',
    'execute'
  ),
  'append-only trigger function is not public API'
);

grant wiser_excon_api to postgres with set true, inherit false;
grant usage on schema extensions to wiser_excon_api;
set local role wiser_excon_api;

select lives_ok(
  $$insert into excon_private.v2_command_intents (
      intent_id, command_name, request_hash, principal, arguments, lease_key_id
    ) values (
      '84000000-0000-4000-8000-000000000001',
      'createRun',
      'sha256:' || repeat('1', 64),
      '{"id":"runtime","participantVersionIds":[]}'::jsonb,
      '["runtime-key",{"label":"runtime"}]'::jsonb,
      'local-v1'
    )$$,
  'the non-superuser API runtime can append an intent through forced RLS'
);
select lives_ok(
  $$insert into excon_private.v2_command_outcomes (
      intent_id, outcome_status, result_hash, generated_ids,
      generated_timestamps, lease_counter_count
    ) values (
      '84000000-0000-4000-8000-000000000001',
      'succeeded',
      'sha256:' || repeat('2', 64),
      '[]'::jsonb,
      '[]'::jsonb,
      0
    )$$,
  'the non-superuser API runtime can append an outcome through forced RLS'
);
select is(
  (
    select count(*)
    from excon_private.v2_command_intents
    where intent_id = '84000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the API runtime can read its appended journal fact'
);
select throws_ok(
  $$update excon_private.v2_command_intents
    set request_hash = 'sha256:' || repeat('3', 64)$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from intent updates'
);
select throws_ok(
  $$delete from excon_private.v2_command_intents$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from intent deletes'
);
select throws_ok(
  $$truncate table excon_private.v2_command_intents cascade$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from intent truncation'
);
select throws_ok(
  $$update excon_private.v2_command_outcomes
    set result_hash = 'sha256:' || repeat('4', 64)$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from outcome updates'
);
select throws_ok(
  $$delete from excon_private.v2_command_outcomes$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from outcome deletes'
);
select throws_ok(
  $$truncate table excon_private.v2_command_outcomes$$,
  '42501'::char(5),
  null,
  'the API runtime is privilege-fenced from outcome truncation'
);

select lives_ok(
  $$insert into excon_private.v2_command_intents (
      intent_id, command_name, request_hash, principal, arguments, lease_key_id
    )
    select
      (
        '83000000-0000-4000-8000-' || lpad(ordinality::text, 12, '0')
      )::uuid,
      command_name,
      'sha256:' || repeat('5', 64),
      '{"id":"registry","participantVersionIds":[]}'::jsonb,
      case
        when command_name in (
          'beginTask', 'heartbeatTask', 'releaseTask', 'submitTask'
        ) then jsonb_build_array(
          'agent',
          'task',
          'key',
          jsonb_build_object(
            'leaseToken',
            jsonb_build_object(
              '$secretRef',
              jsonb_build_object(
                'kind',
                'lease-token-hash',
                'tokenHash',
                'sha256:' || repeat('6', 64)
              )
            )
          )
        )
        else '[]'::jsonb
      end,
      'local-v1'
    from unnest(array[
      'createScenario', 'createScenarioVersion', 'validateScenarioVersion',
      'publishScenarioVersion', 'createAgent', 'createAgentVersion',
      'createRun', 'joinRun', 'startRun', 'sync', 'claimTask', 'beginTask',
      'heartbeatTask', 'releaseTask', 'submitTask', 'createMessage',
      'createArtifact', 'createArtifactVersion', 'endorseSubmission'
    ]) with ordinality as mutation(command_name, ordinality)$$,
  'the runtime schema accepts every registered mutation envelope'
);
select is(
  (
    select count(distinct command_name)
    from excon_private.v2_command_intents
  ),
  19::bigint,
  'all 19 V2 mutations have database registry coverage'
);

reset role;

select * from finish();
rollback;
