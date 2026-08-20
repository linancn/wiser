begin;

select plan(10);

insert into excon_private.evaluation_jobs (
  episode_id,
  submission_id,
  job_type,
  dedupe_key,
  priority,
  run_after,
  payload
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'allocation_constraint_evaluation',
    'queue-test-low',
    10,
    now() - interval '1 minute',
    '{"constraintsVersion":"constraints-sim-2023-v1"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'allocation_constraint_evaluation',
    'queue-test-high',
    20,
    now() - interval '1 minute',
    '{"constraintsVersion":"constraints-sim-2023-v1"}'::jsonb
  ),
  (
    '50000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'allocation_constraint_evaluation',
    'queue-test-future',
    100,
    now() + interval '1 hour',
    '{"constraintsVersion":"constraints-sim-2023-v1"}'::jsonb
  );

select is(
  (select count(*) from excon_private.claim_evaluation_jobs('worker-a', 1, interval '1 minute')),
  1::bigint,
  'the first worker claims one job'
);

select is(
  (
    select dedupe_key
    from excon_private.evaluation_jobs
    where locked_by = 'worker-a'
  ),
  'queue-test-high',
  'the highest-priority due job is claimed first'
);

select is(
  (select count(*) from excon_private.claim_evaluation_jobs('worker-b', 1, interval '1 minute')),
  1::bigint,
  'a second worker claims a different job'
);

select is(
  (
    select count(distinct id)
    from excon_private.evaluation_jobs
    where locked_by in ('worker-a', 'worker-b')
  ),
  2::bigint,
  'claims never return the same job twice'
);

select is(
  (
    select count(*)
    from excon_private.evaluation_jobs
    where status = 'processing' and attempts = 1
  ),
  2::bigint,
  'claiming increments attempts exactly once'
);

select is(
  (select count(*) from excon_private.claim_evaluation_jobs('worker-c', 10, interval '1 minute')),
  0::bigint,
  'future jobs are not claimed early'
);

select throws_ok(
  $$select * from excon_private.claim_evaluation_jobs('', 1, interval '1 minute')$$,
  '22023'::char(5),
  'worker id is required',
  'blank worker ids are rejected'
);

select throws_ok(
  $$select * from excon_private.claim_evaluation_jobs('worker-x', 0, interval '1 minute')$$,
  '22023'::char(5),
  'claim limit must be between 1 and 100',
  'invalid claim limits are rejected'
);

select throws_ok(
  $$select * from excon_private.claim_evaluation_jobs('worker-x', 1, interval '0 seconds')$$,
  '22023'::char(5),
  'lease must be positive',
  'non-positive leases are rejected'
);

select matches(
  pg_get_functiondef(
    'excon_private.claim_evaluation_jobs(text,integer,interval)'::regprocedure
  ),
  'skip locked',
  'queue claims explicitly use SKIP LOCKED'
);

select * from finish();
rollback;
