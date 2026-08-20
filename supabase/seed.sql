insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'participant-a@agent-excon.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'participant-b@agent-excon.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  )
on conflict (id) do nothing;

insert into public.scenarios (
  id,
  slug,
  title_i18n,
  description_i18n,
  created_by
)
values (
  '20000000-0000-4000-8000-000000000001',
  'jing-jin-ji-yongding-replenishment-2023',
  '{"zh-CN":"京津冀永定河生态补水与多水源联合调度","en":"Jing-Jin-Ji Yongding River Ecological Replenishment and Multi-source Allocation"}'::jsonb,
  '{"zh-CN":"以 2023 年永定河春季生态补水公开事实为锚点的合成联合调度演练，不用于现实调度。","en":"A synthetic coordinated-allocation exercise anchored to public facts about the 2023 Yongding River spring replenishment; not for operational use."}'::jsonb,
  '10000000-0000-4000-8000-000000000001'
);

insert into public.scenario_versions (
  id,
  scenario_id,
  version_no,
  status,
  public_manifest,
  replay_start_at,
  replay_end_at,
  content_hash,
  published_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1,
  'published',
  '{"caseType":"multi_source_ecological_replenishment","defaultLocale":"zh-CN","supportedLocales":["zh-CN","en"],"requiredSubmission":"allocation_plan","factAnchored":true,"simulationOnly":true,"notForOperationalUse":true}'::jsonb,
  '2023-03-22T07:00:00Z',
  '2023-06-15T08:00:00Z',
  repeat('a', 64),
  '2026-08-20T00:00:00Z'
);

insert into public.participant_versions (
  id,
  owner_user_id,
  agent_key,
  version,
  model_ref,
  skill_version,
  workflow_version
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'allocation-agent-a',
    '1.0.0',
    'local-codex-subscription',
    'water-allocation@1',
    'baseline@1'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'allocation-agent-b',
    '1.0.0',
    'openai-compatible/test-model',
    'water-allocation@1',
    'baseline@1'
  );

insert into public.episodes (
  id,
  scenario_version_id,
  participant_version_id,
  state,
  virtual_time,
  last_event_seq,
  last_event_hash
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'evaluating',
    '2023-03-22T07:10:00Z',
    1,
    decode(repeat('11', 32), 'hex')
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'initialized',
    '2023-03-22T07:00:00Z',
    0,
    null
  );

insert into public.episode_members (
  episode_id,
  user_id,
  participant_version_id,
  member_role
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'participant'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'participant'
  );

insert into excon_private.information_items (
  id,
  scenario_version_id,
  batch_key,
  system_component,
  information_type,
  is_synthetic,
  source_ref,
  source_url,
  event_time,
  observed_time,
  ingested_time,
  release_virtual_at,
  payload,
  payload_hash
)
values (
  '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'checkpoint-2023-03-22-1500-cst',
  'guanting-sanjiadian-lugouqiao-cuizhihuiying',
  'official_flow_anchor',
  false,
  'beijing-water-authority-daily-2023-03-22',
  'https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230322_2942113.html',
  '2023-03-22T00:00:00Z',
  '2023-03-22T00:00:00Z',
  '2023-03-22T06:56:00Z',
  '2023-03-22T07:00:00Z',
  '{"unit":"m3/s","guanting":20.7,"sanjiadian":0.8,"lugouqiao":15.2,"cuizhihuiying":18.5,"qujiadianGateOpenedAt":"2023-03-22T12:00:00+08:00","simulationOnly":false}'::jsonb,
  repeat('b', 64)
);

insert into excon_private.injects (
  id,
  episode_id,
  information_item_id,
  state,
  planned_release_virtual_at,
  released_virtual_at,
  released_at
)
values
  (
    '70000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'released',
    '2023-03-22T07:00:00Z',
    '2023-03-22T07:00:00Z',
    '2026-08-20T00:01:00Z'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001',
    'pending',
    '2023-03-22T07:00:00Z',
    null,
    null
  );

insert into public.observations (
  id,
  episode_id,
  inject_id,
  recipient_user_id,
  released_virtual_at,
  accessed_virtual_at,
  accessed_at,
  payload_snapshot,
  payload_hash
)
values (
  '80000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '2023-03-22T07:00:00Z',
  '2023-03-22T07:05:00Z',
  '2026-08-20T00:05:00Z',
  '{"unit":"m3/s","guanting":20.7,"sanjiadian":0.8,"lugouqiao":15.2,"cuizhihuiying":18.5,"qujiadianGateOpenedAt":"2023-03-22T12:00:00+08:00","simulationOnly":false}'::jsonb,
  repeat('b', 64)
);

insert into public.submissions (
  id,
  episode_id,
  participant_version_id,
  actor_user_id,
  revision_no,
  submission_type,
  is_final,
  submitted_virtual_at,
  submitted_at,
  payload,
  payload_hash,
  idempotency_key
)
values (
  '90000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  1,
  'allocation_plan',
  false,
  '2023-03-22T07:10:00Z',
  '2026-08-20T00:10:00Z',
  '{"objective":"maintain_ecological_flow","evidenceObservationIds":["80000000-0000-4000-8000-000000000001"]}'::jsonb,
  repeat('c', 64),
  'seed-allocation-plan-0001'
);

insert into public.allocation_plans (
  id,
  submission_id,
  episode_id,
  actor_user_id,
  plan_start_at,
  plan_end_at,
  total_volume_m3,
  constraints_version,
  summary_i18n
)
values (
  'a0000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '2023-03-22T07:10:00Z',
  '2023-03-23T03:10:00Z',
  18000000,
  'constraints-sim-2023-v1',
  '{"zh-CN":"官厅水库、南水北调中线水与再生水联合补水合成方案","en":"Synthetic joint replenishment plan using Guanting Reservoir, Middle Route transfer water, and reclaimed water"}'::jsonb
);

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
  max_flow_m3_s,
  priority
)
values
  (
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'south-to-north-middle-route',
    'yongding-river-ecological-corridor',
    'south_north_diversion',
    'ecological_replenishment',
    '2023-03-22T07:10:00Z',
    '2023-03-23T00:00:00Z',
    8000000,
    15,
    10
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'guanting-reservoir',
    'yongding-river-ecological-corridor',
    'reservoir_release',
    'ecological_replenishment',
    '2023-03-23T00:00:00Z',
    '2023-03-23T03:10:00Z',
    10000000,
    18,
    20
  );

insert into excon_private.water_system_outcomes (
  id,
  scenario_version_id,
  checkpoint_key,
  system_component,
  metric_code,
  metric_value,
  unit,
  observed_at,
  ingested_at,
  source_ref,
  outcome_version,
  fact_hash
)
values (
  'c0000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'checkpoint-2023-03-23-1110-cst',
  'yongding-river-ecological-corridor',
  'ecological_flow_compliance_rate',
  0.94,
  'ratio',
  '2023-03-23T03:10:00Z',
  '2023-03-23T03:11:00Z',
  'simulation-fixture-seed-2023',
  'outcome-sim-v1',
  repeat('d', 64)
);

insert into excon_private.episode_events (
  episode_id,
  seq_no,
  event_type,
  audience,
  actor_user_id,
  virtual_time,
  occurred_at,
  object_type,
  object_id,
  safe_payload,
  previous_hash,
  event_hash
)
values (
  '50000000-0000-4000-8000-000000000001',
  1,
  'submission_accepted',
  'participant',
  '10000000-0000-4000-8000-000000000001',
  '2023-03-22T07:10:00Z',
  '2026-08-20T00:10:00Z',
  'submission',
  '90000000-0000-4000-8000-000000000001',
  '{"submissionType":"allocation_plan","revisionNo":1}'::jsonb,
  null,
  decode(repeat('11', 32), 'hex')
);
