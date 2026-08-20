begin;

select plan(31);

select has_schema('excon_private', 'private schema exists');

select has_table('public', 'scenarios', 'scenarios table exists');
select has_table('public', 'scenario_versions', 'scenario_versions table exists');
select has_table('public', 'participant_versions', 'participant_versions table exists');
select has_table('public', 'episodes', 'episodes table exists');
select has_table('public', 'episode_members', 'episode_members table exists');
select has_table('public', 'observations', 'observations table exists');
select has_table('public', 'submissions', 'submissions table exists');
select has_table('public', 'allocation_plans', 'allocation_plans table exists');
select has_table('public', 'allocation_items', 'allocation_items table exists');
select has_table('public', 'feedbacks', 'feedbacks table exists');

select has_table('excon_private', 'information_items', 'information_items table exists');
select has_table('excon_private', 'injects', 'injects table exists');
select has_table(
  'excon_private',
  'water_system_outcomes',
  'water_system_outcomes table exists'
);
select has_table('excon_private', 'evaluation_jobs', 'evaluation_jobs table exists');
select has_table('excon_private', 'evaluations', 'evaluations table exists');
select has_table('excon_private', 'command_receipts', 'command_receipts table exists');
select has_table('excon_private', 'episode_events', 'episode_events table exists');

select has_function(
  'excon_private',
  'claim_evaluation_jobs',
  array['text', 'integer', 'interval'],
  'claim_evaluation_jobs function exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.scenarios'::regclass),
  'scenarios has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.scenario_versions'::regclass),
  'scenario_versions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.participant_versions'::regclass),
  'participant_versions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass),
  'episodes has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.episode_members'::regclass),
  'episode_members has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.observations'::regclass),
  'observations has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.submissions'::regclass),
  'submissions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.allocation_plans'::regclass),
  'allocation_plans has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.allocation_items'::regclass),
  'allocation_items has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.feedbacks'::regclass),
  'feedbacks has RLS enabled'
);

select has_index(
  'excon_private',
  'evaluation_jobs',
  'evaluation_jobs_claim_idx',
  'queue claim partial index exists'
);

select is(
  (
    select count(*)
    from pg_constraint as c
    join pg_attribute as a
      on a.attrelid = c.conrelid
      and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.connamespace in (
        'public'::regnamespace,
        'excon_private'::regnamespace
      )
      and not exists (
        select 1
        from pg_index as i
        where i.indrelid = c.conrelid
          and (i.indkey::smallint[])[0:cardinality(c.conkey) - 1] = c.conkey
      )
  ),
  0::bigint,
  'every foreign-key column is indexed'
);

select * from finish();
rollback;
