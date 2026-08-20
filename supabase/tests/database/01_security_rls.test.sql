begin;

select plan(21);

select ok(
  not has_table_privilege('anon', 'public.scenarios', 'select'),
  'anonymous users have no scenario table grant'
);
select ok(
  has_table_privilege('authenticated', 'public.scenarios', 'select'),
  'authenticated users have the explicit scenario read grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.submissions', 'insert'),
  'authenticated users cannot bypass submission transactions'
);
select ok(
  not has_schema_privilege('anon', 'excon_private', 'usage'),
  'anonymous users cannot use the private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'excon_private', 'usage'),
  'authenticated users cannot use the private schema'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'excon_private.claim_evaluation_jobs(text,integer,interval)',
    'execute'
  ),
  'participants cannot claim evaluator jobs'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select is((select count(*) from public.scenarios), 1::bigint, 'A sees the published scenario');
select is((select count(*) from public.scenario_versions), 2::bigint, 'A sees both published versions');
select is((select count(*) from public.participant_versions), 1::bigint, 'A sees only its agent version');
select is((select count(*) from public.episodes), 1::bigint, 'A sees only its episode');
select is((select count(*) from public.episode_members), 1::bigint, 'A sees only its membership');
select is((select count(*) from public.observations), 1::bigint, 'A sees its delivered observation');
select is((select count(*) from public.submissions), 1::bigint, 'A sees its submission');
select is((select count(*) from public.allocation_plans), 1::bigint, 'A sees its allocation plan');
select is((select count(*) from public.allocation_items), 2::bigint, 'A sees its allocation items');
select is((select count(*) from public.feedbacks), 0::bigint, 'A has no feedback before evaluation');

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

select is((select count(*) from public.episodes), 1::bigint, 'B sees only its episode');
select is((select count(*) from public.observations), 0::bigint, 'B cannot see A observations');
select is((select count(*) from public.submissions), 0::bigint, 'B cannot see A submissions');
select is((select count(*) from public.allocation_plans), 0::bigint, 'B cannot see A allocation plan');
select is((select count(*) from public.allocation_items), 0::bigint, 'B cannot see A allocation items');

reset role;

select * from finish();
rollback;
