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
  owner_user_id,
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
  '10000000-0000-4000-8000-000000000001',
  1,
  'draft',
  '{"caseType":"multi_source_ecological_replenishment","defaultLocale":"zh-CN","supportedLocales":["zh-CN","en"],"requiredSubmission":"allocation_plan","factAnchored":true,"simulationOnly":true,"notForOperationalUse":true}'::jsonb,
  '2023-03-22T07:00:00Z',
  '2023-06-15T08:00:00Z',
  repeat('a', 64),
  null
);

update public.scenario_versions
set status = 'published',
    published_at = '2026-08-20T00:00:00Z'
where id = '30000000-0000-4000-8000-000000000001';

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

-- v2 multi-scenario / multi-agent vertical slice ----------------------------

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '10000000-0000-4000-8000-000000000003',
    'participant-c@agent-excon.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'participant-d@agent-excon.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'operator@agent-excon.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  )
on conflict (id) do nothing;

insert into public.scenario_versions (
  id,
  scenario_id,
  owner_user_id,
  version_no,
  status,
  public_manifest,
  replay_start_at,
  replay_end_at,
  content_hash,
  min_distinct_required_agents,
  compatibility_mode
)
values (
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  2,
  'draft',
  '{"caseType":"multi_agent_yongding_replenishment","defaultLocale":"zh-CN","supportedLocales":["zh-CN","en"],"requiredRoles":["evidence_analyst","hydraulic_analyst","ecology_analyst","dispatch_coordinator"],"simulationOnly":true,"notForOperationalUse":true}'::jsonb,
  '2023-03-22T07:00:00Z',
  '2023-06-15T08:00:00Z',
  repeat('2', 64),
  4,
  'multi_agent'
);

insert into public.scenario_version_lifecycle_events (
  id,
  scenario_version_id,
  lifecycle_seq,
  from_state,
  to_state,
  actor_user_id,
  reason,
  occurred_at
)
values (
  '30100000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  1,
  null,
  'draft',
  '10000000-0000-4000-8000-000000000001',
  'Seed the Yongding River four-role exercise draft',
  '2026-08-20T01:00:00Z'
);

insert into public.role_definitions (
  id,
  scenario_version_id,
  role_key,
  title_i18n,
  description_i18n,
  is_required,
  min_slots,
  max_slots,
  capability_requirements,
  ordinal
)
values
  (
    '31000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'evidence_analyst',
    '{"zh-CN":"水情与证据智能体","en":"Hydrology and Evidence Agent"}'::jsonb,
    '{"zh-CN":"核验公开水情、来源、时态与修订。","en":"Verifies public hydrology, provenance, timing, and revisions."}'::jsonb,
    true,
    1,
    1,
    '["evidence_provenance","hydrology"]'::jsonb,
    10
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'hydraulic_analyst',
    '{"zh-CN":"水动力约束智能体","en":"Hydraulic Constraint Agent"}'::jsonb,
    '{"zh-CN":"分析河道、断面、容量、损失和传播约束。","en":"Analyzes channel, cross-section, capacity, loss, and routing constraints."}'::jsonb,
    true,
    1,
    1,
    '["hydraulics","constraint_analysis"]'::jsonb,
    20
  ),
  (
    '31000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000002',
    'ecology_analyst',
    '{"zh-CN":"生态目标智能体","en":"Ecological Target Agent"}'::jsonb,
    '{"zh-CN":"分析生态目标区间、连续性和水质边界。","en":"Analyzes ecological target ranges, continuity, and water-quality boundaries."}'::jsonb,
    true,
    1,
    1,
    '["ecology","risk_prioritization"]'::jsonb,
    30
  ),
  (
    '31000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000002',
    'dispatch_coordinator',
    '{"zh-CN":"调度协调智能体","en":"Dispatch Coordination Agent"}'::jsonb,
    '{"zh-CN":"基于显式共享工件形成联合调度方案。","en":"Builds a joint allocation plan from explicitly shared artifacts."}'::jsonb,
    true,
    1,
    1,
    '["coordination","water_allocation"]'::jsonb,
    40
  );

update public.scenario_versions
set status = 'published',
    published_at = '2026-08-20T01:05:00Z'
where id = '30000000-0000-4000-8000-000000000002';

insert into public.scenario_version_lifecycle_events (
  id,
  scenario_version_id,
  lifecycle_seq,
  from_state,
  to_state,
  actor_user_id,
  reason,
  occurred_at
)
values (
  '30100000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  2,
  'draft',
  'published',
  '10000000-0000-4000-8000-000000000001',
  'Publish the validated four-role exercise blueprint',
  '2026-08-20T01:05:00Z'
);

insert into public.agent_identities (
  id,
  owner_user_id,
  agent_key,
  display_name_i18n,
  description_i18n,
  lifecycle_state
)
values
  (
    '41000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'yongding-evidence-agent',
    '{"zh-CN":"永定河水情证据智能体","en":"Yongding Evidence Agent"}'::jsonb,
    '{"zh-CN":"演练用证据核验实例。","en":"Exercise evidence-verification identity."}'::jsonb,
    'active'
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'yongding-hydraulic-agent',
    '{"zh-CN":"永定河水动力智能体","en":"Yongding Hydraulic Agent"}'::jsonb,
    '{"zh-CN":"演练用水动力约束实例。","en":"Exercise hydraulic-constraint identity."}'::jsonb,
    'active'
  ),
  (
    '41000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'yongding-ecology-agent',
    '{"zh-CN":"永定河生态目标智能体","en":"Yongding Ecology Agent"}'::jsonb,
    '{"zh-CN":"演练用生态目标实例。","en":"Exercise ecological-target identity."}'::jsonb,
    'active'
  ),
  (
    '41000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    'yongding-coordinator-agent',
    '{"zh-CN":"永定河调度协调智能体","en":"Yongding Dispatch Coordinator"}'::jsonb,
    '{"zh-CN":"演练用联合调度实例。","en":"Exercise joint-dispatch identity."}'::jsonb,
    'active'
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    'revoked-lifecycle-test-agent',
    '{"zh-CN":"已撤销生命周期测试智能体","en":"Revoked Lifecycle Test Agent"}'::jsonb,
    '{"zh-CN":"只用于验证撤销终态，不参与任何 Run。","en":"Tests terminal revocation and never joins a Run."}'::jsonb,
    'active'
  );

insert into public.agent_identity_lifecycle_events (
  agent_identity_id,
  lifecycle_seq,
  from_state,
  to_state,
  actor_user_id,
  reason,
  occurred_at
)
select
  id,
  1,
  null,
  'active',
  '10000000-0000-4000-8000-000000000005',
  'Register the seeded exercise agent identity',
  '2026-08-20T01:10:00Z'
from public.agent_identities
where id in (
  '41000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000003',
  '41000000-0000-4000-8000-000000000004',
  '41000000-0000-4000-8000-000000000005'
);

insert into public.agent_versions (
  id,
  agent_identity_id,
  owner_user_id,
  version,
  lifecycle_state,
  provider_kind,
  model_ref,
  protocol_version,
  skill_manifest,
  capabilities,
  telemetry_capabilities,
  content_hash,
  published_at
)
values
  (
    '42000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '1.0.0',
    'draft',
    'local_codex_subscription',
    'local-codex-subscription',
    'excon-v2',
    '{"skill":"wiser-excon","version":"2.0.0"}'::jsonb,
    '["evidence_provenance","hydrology"]'::jsonb,
    '{"otlp":true}'::jsonb,
    repeat('4', 64),
    null
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '41000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '1.0.0',
    'draft',
    'openai_compatible',
    'openai-compatible/test-hydraulic',
    'excon-v2',
    '{"skill":"wiser-excon","version":"2.0.0"}'::jsonb,
    '["hydraulics","constraint_analysis"]'::jsonb,
    '{"otlp":true}'::jsonb,
    repeat('5', 64),
    null
  ),
  (
    '42000000-0000-4000-8000-000000000003',
    '41000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '1.0.0',
    'draft',
    'openai_compatible',
    'openai-compatible/test-ecology',
    'excon-v2',
    '{"skill":"wiser-excon","version":"2.0.0"}'::jsonb,
    '["ecology","risk_prioritization"]'::jsonb,
    '{"otlp":true}'::jsonb,
    repeat('6', 64),
    null
  ),
  (
    '42000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '1.0.0',
    'draft',
    'openai_compatible',
    'openai-compatible/test-coordinator',
    'excon-v2',
    '{"skill":"wiser-excon","version":"2.0.0"}'::jsonb,
    '["coordination","water_allocation"]'::jsonb,
    '{"otlp":true}'::jsonb,
    repeat('7', 64),
    null
  );

update public.agent_versions
set lifecycle_state = 'published',
    published_at = '2026-08-20T01:15:00Z'
where id in (
  '42000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000003',
  '42000000-0000-4000-8000-000000000004'
);

insert into public.agent_version_lifecycle_events (
  agent_version_id,
  lifecycle_seq,
  from_state,
  to_state,
  actor_user_id,
  reason,
  occurred_at
)
select
  id,
  1,
  'draft',
  'published',
  '10000000-0000-4000-8000-000000000005',
  'Publish the seeded reproducible agent version',
  '2026-08-20T01:15:00Z'
from public.agent_versions
where id in (
  '42000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000003',
  '42000000-0000-4000-8000-000000000004'
);

insert into public.exercise_runs (
  id,
  scenario_version_id,
  created_by,
  state,
  current_phase_key,
  virtual_time
)
values (
  '51000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000005',
  'forming',
  'parallel-analysis',
  '2023-03-22T07:10:00Z'
);

insert into public.run_human_members (run_id, user_id, member_role)
values (
  '51000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000005',
  'operator'
);

insert into public.run_teams (id, run_id, team_key, title_i18n)
values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'joint-dispatch',
  '{"zh-CN":"永定河联合调度组","en":"Yongding Joint Dispatch Team"}'::jsonb
);

insert into public.run_agents (
  id,
  run_id,
  agent_version_id,
  owner_user_id,
  team_id,
  instance_key,
  state,
  joined_at
)
values
  (
    '53000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    'evidence-instance-01',
    'ready',
    '2026-08-20T01:20:00Z'
  ),
  (
    '53000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000001',
    'hydraulic-instance-01',
    'ready',
    '2026-08-20T01:20:00Z'
  ),
  (
    '53000000-0000-4000-8000-000000000003',
    '51000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000001',
    'ecology-instance-01',
    'ready',
    '2026-08-20T01:20:00Z'
  ),
  (
    '53000000-0000-4000-8000-000000000004',
    '51000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '52000000-0000-4000-8000-000000000001',
    'coordinator-instance-01',
    'ready',
    '2026-08-20T01:20:00Z'
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
values
  (
    '54000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    1,
    'primary',
    true
  ),
  (
    '54000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000002',
    1,
    'primary',
    true
  ),
  (
    '54000000-0000-4000-8000-000000000003',
    '51000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000003',
    1,
    'primary',
    true
  ),
  (
    '54000000-0000-4000-8000-000000000004',
    '51000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000004',
    '31000000-0000-4000-8000-000000000004',
    1,
    'primary',
    true
  );

update public.exercise_runs
set state = 'ready'
where id = '51000000-0000-4000-8000-000000000001';

insert into public.run_tasks (
  id,
  run_id,
  task_key,
  eligible_role_definition_id,
  title_i18n,
  state,
  input_payload,
  output_schema,
  priority,
  available_virtual_at
)
values
  (
    '55000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'analyze.evidence',
    '31000000-0000-4000-8000-000000000001',
    '{"zh-CN":"核验水情证据","en":"Verify hydrology evidence"}'::jsonb,
    'ready',
    '{"sourceSet":"official-2023-anchor"}'::jsonb,
    '{"type":"object"}'::jsonb,
    30,
    '2023-03-22T07:00:00Z'
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000001',
    'analyze.hydraulics',
    '31000000-0000-4000-8000-000000000002',
    '{"zh-CN":"分析水动力约束","en":"Analyze hydraulic constraints"}'::jsonb,
    'ready',
    '{"network":"yongding-synthetic-v2"}'::jsonb,
    '{"type":"object"}'::jsonb,
    20,
    '2023-03-22T07:00:00Z'
  ),
  (
    '55000000-0000-4000-8000-000000000003',
    '51000000-0000-4000-8000-000000000001',
    'analyze.ecology',
    '31000000-0000-4000-8000-000000000003',
    '{"zh-CN":"分析生态目标","en":"Analyze ecological targets"}'::jsonb,
    'ready',
    '{"targetSet":"ecology-synthetic-v2"}'::jsonb,
    '{"type":"object"}'::jsonb,
    10,
    '2023-03-22T07:00:00Z'
  ),
  (
    '55000000-0000-4000-8000-000000000004',
    '51000000-0000-4000-8000-000000000001',
    'coordinate.joint-plan',
    '31000000-0000-4000-8000-000000000004',
    '{"zh-CN":"形成联合调度方案","en":"Build the joint dispatch plan"}'::jsonb,
    'blocked',
    '{"requiresBarrier":"analysis-ready"}'::jsonb,
    '{"type":"object"}'::jsonb,
    40,
    '2023-03-22T07:10:00Z'
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
  '56000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'analysis-ready',
  'all_required',
  3,
  'closed'
);

select * from excon_private.append_run_event(
  '51000000-0000-4000-8000-000000000001',
  'run.ready',
  'run',
  '51000000-0000-4000-8000-000000000001',
  'human_member',
  '10000000-0000-4000-8000-000000000005',
  'operator_asserted',
  null,
  'staffing',
  '2023-03-22T07:00:00Z',
  '{"requiredRoles":4,"distinctRunAgents":4}'::jsonb,
  null,
  '57000000-0000-4000-8000-000000000001'
);

insert into public.event_disclosures (
  id,
  run_id,
  run_agent_id,
  source_event_id,
  source_run_seq,
  granted_event_id,
  granted_run_seq,
  resource_type,
  resource_id,
  resource_version,
  available_virtual_at
)
values (
  '58000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000001',
  1,
  '57000000-0000-4000-8000-000000000001',
  1,
  'run_task',
  '55000000-0000-4000-8000-000000000001',
  'lock:0',
  '2023-03-22T07:00:00Z'
);

insert into public.delivery_batches (
  id,
  run_id,
  run_agent_id,
  idempotency_key,
  request_hash,
  after_receipt_seq,
  run_cursor,
  has_more,
  created_at
)
values (
  '59000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  'seed-sync-batch-0001',
  decode(repeat('91', 32), 'hex'),
  0,
  1,
  false,
  '2026-08-20T01:25:00Z'
);

insert into public.agent_view_receipts (
  id,
  run_id,
  run_agent_id,
  agent_receipt_seq,
  delivery_batch_id,
  disclosure_id,
  source_event_id,
  source_run_seq,
  issued_event_id,
  issued_run_seq,
  view_kind,
  resource_type,
  resource_id,
  resource_version,
  available_virtual_at,
  issued_virtual_at,
  issued_at,
  content_snapshot,
  content_hash,
  previous_receipt_hash,
  receipt_hash
)
values (
  '5a000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  1,
  '59000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000001',
  '57000000-0000-4000-8000-000000000001',
  1,
  '57000000-0000-4000-8000-000000000001',
  1,
  'task',
  'run_task',
  '55000000-0000-4000-8000-000000000001',
  'lock:0',
  '2023-03-22T07:00:00Z',
  '2023-03-22T07:00:00Z',
  '2026-08-20T01:25:00Z',
  '{"taskId":"55000000-0000-4000-8000-000000000001","taskKey":"analyze.evidence","lockVersion":0}'::jsonb,
  repeat('0', 64),
  null,
  decode(repeat('00', 32), 'hex')
);

insert into public.acknowledgements (
  id,
  run_id,
  run_agent_id,
  delivery_batch_id,
  through_receipt_seq,
  acknowledged_head_hash,
  acknowledged_event_id,
  acknowledged_run_seq,
  command_receipt_key,
  acknowledged_at
)
select
  '5b000000-0000-4000-8000-000000000001',
  receipt.run_id,
  receipt.run_agent_id,
  receipt.delivery_batch_id,
  receipt.agent_receipt_seq,
  receipt.receipt_hash,
  receipt.issued_event_id,
  receipt.issued_run_seq,
  'seed-sync-ack-0001',
  '2026-08-20T01:26:00Z'
from public.agent_view_receipts as receipt
where receipt.id = '5a000000-0000-4000-8000-000000000001';

insert into excon_private.run_agent_credentials (
  id,
  run_agent_id,
  run_id,
  token_key_id,
  token_hash,
  scopes,
  issued_at,
  expires_at,
  created_by
)
values (
  '5c000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'seed-key-01',
  decode(repeat('a1', 32), 'hex'),
  array['run:sync', 'task:claim', 'telemetry:write'],
  '2026-08-20T01:20:00Z',
  '2026-08-20T03:20:00Z',
  '10000000-0000-4000-8000-000000000005'
);

insert into excon_private.telemetry_sessions (
  id,
  run_id,
  run_agent_id,
  credential_id,
  session_key,
  trust_class,
  resource_attributes,
  started_at,
  last_seen_at
)
values (
  '5d000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  '5c000000-0000-4000-8000-000000000001',
  'seed-otel-session-01',
  'participant_reported',
  '{"wiser.excon.run.id":"51000000-0000-4000-8000-000000000001","wiser.excon.run_agent.id":"53000000-0000-4000-8000-000000000001"}'::jsonb,
  '2026-08-20T01:24:00Z',
  '2026-08-20T01:25:00Z'
);

update public.agent_identities
set lifecycle_state = 'revoked'
where id = '41000000-0000-4000-8000-000000000005';

insert into public.agent_identity_lifecycle_events (
  id,
  agent_identity_id,
  lifecycle_seq,
  from_state,
  to_state,
  actor_user_id,
  reason,
  occurred_at
)
values (
  '41100000-0000-4000-8000-000000000005',
  '41000000-0000-4000-8000-000000000005',
  2,
  'active',
  'revoked',
  '10000000-0000-4000-8000-000000000005',
  'Seed a terminal identity lifecycle fixture for negative tests',
  '2026-08-20T01:30:00Z'
);

-- WISER unified platform identity and authorization -------------------------

insert into platform.tenants (
  id,
  slug,
  name_zh_cn,
  name_en,
  status,
  created_by_actor_id
)
values (
  'b1000000-0000-4000-8000-000000000001',
  'wiser-local',
  'WISER 本地工作区',
  'WISER Local Workspace',
  'active',
  '10000000-0000-4000-8000-000000000005'
)
on conflict (id) do nothing;

insert into platform.tenant_memberships (
  tenant_id,
  actor_id,
  status,
  membership_version
)
select
  'b1000000-0000-4000-8000-000000000001',
  actor.id,
  'active',
  1
from platform.actors as actor
where actor.id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005'
)
on conflict (tenant_id, actor_id) do nothing;

insert into platform.projects (
  id,
  tenant_id,
  slug,
  name_zh_cn,
  name_en,
  status,
  created_by_actor_id
)
values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'yongding-lab',
  '永定河协同实验室',
  'Yongding Collaboration Lab',
  'active',
  '10000000-0000-4000-8000-000000000005'
)
on conflict (id) do nothing;

insert into platform.project_memberships (
  project_id,
  tenant_id,
  actor_id,
  status,
  membership_version
)
select
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  membership.actor_id,
  'active',
  1
from platform.tenant_memberships as membership
where membership.tenant_id = 'b1000000-0000-4000-8000-000000000001'
on conflict (project_id, actor_id) do nothing;

insert into platform.roles (
  id,
  role_key,
  system_id,
  status
)
values
  (
    'b3000000-0000-4000-8000-000000000001',
    'platform-owner',
    'platform',
    'active'
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    'excon-operator',
    'excon',
    'active'
  ),
  (
    'b3000000-0000-4000-8000-000000000003',
    'excon-run-agent',
    'excon',
    'active'
  ),
  (
    'b3000000-0000-4000-8000-000000000004',
    'data-steward',
    'data',
    'active'
  ),
  (
    'b3000000-0000-4000-8000-000000000005',
    'data-reader',
    'data',
    'active'
  )
on conflict (id) do nothing;

insert into platform.role_scopes (role_id, scope)
values
  ('b3000000-0000-4000-8000-000000000001', 'platform.project.manage'),
  ('b3000000-0000-4000-8000-000000000001', 'platform.delegation.manage'),
  ('b3000000-0000-4000-8000-000000000002', 'excon.scenario.manage'),
  ('b3000000-0000-4000-8000-000000000002', 'excon.run.manage'),
  ('b3000000-0000-4000-8000-000000000002', 'excon.run.read'),
  ('b3000000-0000-4000-8000-000000000003', 'excon.run-agent.act'),
  ('b3000000-0000-4000-8000-000000000003', 'excon.telemetry.write'),
  ('b3000000-0000-4000-8000-000000000004', 'data.catalog.read'),
  ('b3000000-0000-4000-8000-000000000004', 'data.ingestion.write'),
  ('b3000000-0000-4000-8000-000000000004', 'data.publish'),
  ('b3000000-0000-4000-8000-000000000005', 'data.catalog.read'),
  ('b3000000-0000-4000-8000-000000000005', 'data.query')
on conflict (role_id, scope) do nothing;

insert into platform.role_bindings (
  id,
  actor_id,
  tenant_id,
  project_id,
  role_id,
  status,
  created_by_actor_id
)
values
  (
    'b4000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'active',
    '10000000-0000-4000-8000-000000000005'
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'active',
    '10000000-0000-4000-8000-000000000005'
  ),
  (
    'b4000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000004',
    'active',
    '10000000-0000-4000-8000-000000000005'
  );

insert into platform.role_bindings (
  id,
  actor_id,
  tenant_id,
  project_id,
  role_id,
  status,
  created_by_actor_id
)
select
  (
    'b5000000-0000-4000-8000-'
    || lpad(row_number() over (order by member.actor_id)::text, 12, '0')
  )::uuid,
  member.actor_id,
  member.tenant_id,
  member.project_id,
  'b3000000-0000-4000-8000-000000000003',
  'active',
  '10000000-0000-4000-8000-000000000005'
from platform.project_memberships as member
where member.project_id = 'b2000000-0000-4000-8000-000000000001'
  and member.actor_id <> '10000000-0000-4000-8000-000000000005'
on conflict (id) do nothing;
