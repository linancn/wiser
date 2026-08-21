create table if not exists catalog.data_item (
  data_item_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  owner_project_id uuid not null,
  name text not null,
  business_domains text[] not null,
  source_natures text[] not null,
  source_channels text[] not null,
  processing_stage text not null,
  intended_uses text[] not null,
  source_organization text not null,
  source_contact jsonb,
  authorization_scope text not null,
  citation_requirements text[] not null default '{}',
  source_crs text,
  canonical_crs text,
  timezone text,
  temporal_resolution text,
  schema_version_id uuid,
  unit_definitions jsonb not null default '[]',
  missing_value_rules jsonb not null default '[]',
  anomaly_rules jsonb not null default '[]',
  generation_method text not null,
  quality_grade text not null,
  acceptance_status text not null,
  publication_status text not null,
  security_level text not null,
  version bigint not null default 1,
  update_mode text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint data_item_owner_project check (owner_project_id = project_id),
  constraint data_item_domains_nonempty check (cardinality(business_domains) > 0),
  constraint data_item_processing_stage check (processing_stage in ('RAW', 'CLEANED', 'STANDARDIZED', 'INTERMEDIATE', 'KNOWLEDGE', 'METADATA_QUALITY')),
  constraint data_item_quality_grade check (quality_grade in ('A', 'B', 'C')),
  constraint data_item_acceptance_status check (acceptance_status in ('PENDING', 'PASSED', 'CONDITIONALLY_PASSED', 'CORRECTION_REQUIRED', 'ARCHIVED_ONLY', 'REJECTED')),
  constraint data_item_publication_status check (publication_status in ('UNPUBLISHED', 'PUBLISHING', 'PUBLISHED', 'WITHDRAWN')),
  constraint data_item_security_level check (security.is_valid_security_level(security_level)),
  constraint data_item_generation_method check (generation_method in ('OBSERVED', 'DECLARED', 'DERIVED_DETERMINISTIC', 'DERIVED_AI_ASSISTED', 'SYNTHETIC', 'MODEL_OUTPUT')),
  constraint data_item_update_mode check (update_mode in ('APPEND', 'REPLACE', 'UPSERT', 'SNAPSHOT')),
  constraint data_item_versions_positive check (version > 0 and policy_version > 0 and row_version > 0),
  unique (tenant_id, project_id, data_item_id)
);

create table if not exists catalog.schema_version (
  schema_version_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_number bigint not null,
  json_schema jsonb not null,
  schema_hash bytea not null,
  compatibility_mode text not null default 'BACKWARD',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint schema_version_security_level check (security.is_valid_security_level(security_level)),
  constraint schema_version_hash_length check (octet_length(schema_hash) = 32),
  constraint schema_version_numbers_positive check (version_number > 0 and policy_version > 0 and row_version > 0),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  unique (tenant_id, project_id, schema_version_id),
  unique (tenant_id, project_id, data_item_id, version_number)
);

alter table catalog.data_item
  add constraint data_item_schema_version_fk
  foreign key (tenant_id, project_id, schema_version_id)
  references catalog.schema_version (tenant_id, project_id, schema_version_id);

create table if not exists catalog.data_item_version (
  version_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_number bigint not null,
  asset_manifest jsonb not null,
  source_hash bytea not null,
  metadata_hash bytea not null,
  schema_version_id uuid,
  processing_stage text not null,
  generation_method text not null,
  quality_grade text not null,
  acceptance_status text not null,
  publication_status text not null,
  security_level text not null,
  supersedes_version_id uuid,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  committed_at timestamptz not null,
  published_at timestamptz,
  constraint data_item_version_security_level check (security.is_valid_security_level(security_level)),
  constraint data_item_version_hashes check (octet_length(source_hash) = 32 and octet_length(metadata_hash) = 32),
  constraint data_item_version_numbers_positive check (version_number > 0 and policy_version > 0 and row_version = 1),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, schema_version_id) references catalog.schema_version (tenant_id, project_id, schema_version_id),
  foreign key (tenant_id, project_id, supersedes_version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, data_item_id, version_number)
);

create table if not exists catalog.asset (
  asset_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid,
  storage_key text not null,
  content_hash bytea not null,
  media_type text not null,
  byte_size bigint not null,
  lifecycle_state text not null default 'QUARANTINED',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint asset_security_level check (security.is_valid_security_level(security_level)),
  constraint asset_hash_size check (octet_length(content_hash) = 32 and byte_size >= 0),
  constraint asset_immutable_version check (row_version = 1),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, asset_id),
  unique (tenant_id, project_id, storage_key),
  unique (tenant_id, project_id, content_hash)
);

create table if not exists catalog.field_definition (
  field_definition_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  schema_version_id uuid not null,
  field_name text not null,
  field_position integer not null,
  data_type text not null,
  nullable boolean not null,
  source_unit text,
  canonical_unit text,
  missing_value_rule jsonb,
  anomaly_rule jsonb,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint field_definition_security_level check (security.is_valid_security_level(security_level)),
  constraint field_definition_position check (field_position >= 0 and policy_version > 0 and row_version > 0),
  foreign key (tenant_id, project_id, schema_version_id) references catalog.schema_version (tenant_id, project_id, schema_version_id),
  unique (tenant_id, project_id, field_definition_id),
  unique (tenant_id, project_id, schema_version_id, field_name)
);

create table if not exists catalog.source_provenance (
  provenance_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_id uuid,
  source_organization text not null,
  source_contact jsonb,
  source_uri text,
  citation text,
  acquired_at timestamptz,
  content_hash bytea,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint source_provenance_security_level check (security.is_valid_security_level(security_level)),
  constraint source_provenance_hash check (content_hash is null or octet_length(content_hash) = 32),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, provenance_id)
);

create table if not exists catalog.spatial_extent (
  spatial_extent_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_id uuid,
  source_geometry geometry not null,
  source_crs text not null,
  canonical_geometry geometry(Geometry, 4490) not null,
  canonical_crs text not null default 'EPSG:4490',
  display_geometry geometry(Geometry, 3857),
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint spatial_extent_security_level check (security.is_valid_security_level(security_level)),
  constraint spatial_extent_canonical_crs check (canonical_crs = 'EPSG:4490' and st_srid(canonical_geometry) = 4490),
  constraint spatial_extent_display_crs check (display_geometry is null or st_srid(display_geometry) = 3857),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, spatial_extent_id)
);

create table if not exists catalog.temporal_extent (
  temporal_extent_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  temporal_resolution text,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint temporal_extent_security_level check (security.is_valid_security_level(security_level)),
  constraint temporal_extent_order check (starts_at <= ends_at),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, temporal_extent_id)
);

create table if not exists service.capability (
  capability_record_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  capability_id text not null,
  kind text not null,
  enabled boolean not null default true,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint capability_security_level check (security.is_valid_security_level(security_level)),
  constraint capability_kind check (kind in ('query', 'command')),
  unique (tenant_id, project_id, capability_record_id),
  unique (tenant_id, project_id, capability_id)
);

create table if not exists service.capability_version (
  capability_version_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  capability_record_id uuid not null,
  semantic_version text not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  transport_mappings jsonb not null,
  execution_policy jsonb not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint capability_version_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, capability_record_id) references service.capability (tenant_id, project_id, capability_record_id),
  unique (tenant_id, project_id, capability_version_id),
  unique (tenant_id, project_id, capability_record_id, semantic_version)
);

create table if not exists service.operation (
  operation_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  capability_id text not null,
  actor_id uuid not null,
  status text not null default 'PENDING',
  progress_percent integer not null default 0,
  idempotency_key text,
  request_payload jsonb not null,
  result_payload jsonb,
  error_code text,
  error_message text,
  error_retryable boolean,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint operation_status check (status in ('PENDING', 'RUNNING', 'WAITING_INPUT', 'WAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  constraint operation_security_level check (security.is_valid_security_level(security_level)),
  constraint operation_progress check (progress_percent between 0 and 100),
  unique (tenant_id, project_id, operation_id),
  unique (tenant_id, project_id, idempotency_key)
);

create table if not exists ingestion.session (
  ingestion_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  operation_id uuid not null,
  owner_project_id uuid not null,
  state text not null default 'RECEIVED',
  intended_uses text[] not null,
  expected_version bigint not null default 1,
  requested_security_level text not null,
  approved_by_actor_id uuid,
  approved_at timestamptz,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ingestion_session_security_level check (security.is_valid_security_level(security_level)),
  constraint ingestion_session_requested_security check (security.is_valid_security_level(requested_security_level)),
  constraint ingestion_session_state check (state in ('RECEIVED', 'QUARANTINED', 'SECURITY_SCANNED', 'FINGERPRINTED', 'PROFILED', 'CLASSIFIED', 'SCHEMA_MAPPED', 'SEMANTIC_MAPPED', 'VALIDATED', 'SPATIOTEMPORAL_ALIGNED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'COMMITTED', 'PROJECTING', 'PUBLISHED', 'FAILED', 'CANCELLED')),
  foreign key (tenant_id, project_id, operation_id) references service.operation (tenant_id, project_id, operation_id),
  unique (tenant_id, project_id, ingestion_id)
);

create table if not exists ingestion.input_asset (
  input_asset_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid not null,
  asset_id uuid not null,
  ordinal integer not null,
  scan_status text not null default 'PENDING',
  fingerprint bytea,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint input_asset_security_level check (security.is_valid_security_level(security_level)),
  constraint input_asset_ordinal check (ordinal >= 0),
  constraint input_asset_fingerprint check (fingerprint is null or octet_length(fingerprint) = 32),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  foreign key (tenant_id, project_id, asset_id) references catalog.asset (tenant_id, project_id, asset_id),
  unique (tenant_id, project_id, input_asset_id),
  unique (tenant_id, project_id, ingestion_id, asset_id)
);

create table if not exists ingestion.agent_run (
  agent_run_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid not null,
  agent_kind text not null,
  provider text not null,
  model text not null,
  deterministic boolean not null default false,
  input_hash bytea not null,
  output_hash bytea,
  status text not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint agent_run_security_level check (security.is_valid_security_level(security_level)),
  constraint agent_run_hashes check (octet_length(input_hash) = 32 and (output_hash is null or octet_length(output_hash) = 32)),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  unique (tenant_id, project_id, agent_run_id)
);

create table if not exists ingestion.agent_action (
  agent_action_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  agent_run_id uuid not null,
  action_type text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  requires_approval boolean not null default false,
  approved_by_actor_id uuid,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint agent_action_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, agent_run_id) references ingestion.agent_run (tenant_id, project_id, agent_run_id),
  unique (tenant_id, project_id, agent_action_id)
);

create table if not exists ingestion.transform_plan (
  transform_plan_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid not null,
  plan_version bigint not null,
  plan jsonb not null,
  plan_hash bytea not null,
  status text not null default 'DRAFT',
  approved_by_actor_id uuid,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint transform_plan_security_level check (security.is_valid_security_level(security_level)),
  constraint transform_plan_hash check (octet_length(plan_hash) = 32),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  unique (tenant_id, project_id, transform_plan_id),
  unique (tenant_id, project_id, ingestion_id, plan_version)
);

create table if not exists ingestion.review (
  review_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid not null,
  reviewer_actor_id uuid not null,
  decision text not null,
  rationale text,
  conditions jsonb not null default '[]',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ingestion_review_security_level check (security.is_valid_security_level(security_level)),
  constraint ingestion_review_decision check (decision in ('APPROVED', 'REJECTED', 'CORRECTION_REQUIRED')),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  unique (tenant_id, project_id, review_id)
);

create table if not exists ingestion.job (
  job_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid,
  operation_id uuid not null,
  job_type text not null,
  status text not null default 'PENDING',
  idempotency_key text not null,
  priority integer not null default 0,
  depends_on_job_id uuid,
  payload jsonb not null,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  backoff_base_seconds integer not null default 5,
  next_attempt_at timestamptz not null default clock_timestamp(),
  error_category text,
  cancel_requested_at timestamptz,
  timeout_at timestamptz,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ingestion_job_security_level check (security.is_valid_security_level(security_level)),
  constraint ingestion_job_status check (status in ('PENDING', 'RUNNING', 'WAITING_INPUT', 'WAITING_REVIEW', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER')),
  constraint ingestion_job_attempts check (attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts),
  constraint ingestion_job_backoff check (backoff_base_seconds > 0),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  foreign key (tenant_id, project_id, operation_id) references service.operation (tenant_id, project_id, operation_id),
  foreign key (tenant_id, project_id, depends_on_job_id) references ingestion.job (tenant_id, project_id, job_id),
  unique (tenant_id, project_id, job_id),
  unique (tenant_id, project_id, idempotency_key)
);

create table if not exists ingestion.job_attempt (
  job_attempt_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  worker_id text not null,
  outcome text,
  error_category text,
  error_detail jsonb,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint job_attempt_security_level check (security.is_valid_security_level(security_level)),
  constraint job_attempt_number check (attempt_number > 0),
  foreign key (tenant_id, project_id, job_id) references ingestion.job (tenant_id, project_id, job_id),
  unique (tenant_id, project_id, job_attempt_id),
  unique (tenant_id, project_id, job_id, attempt_number)
);

create table if not exists quality.rule_definition (
  rule_definition_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  rule_key text not null,
  rule_version bigint not null,
  definition jsonb not null,
  blocking boolean not null default false,
  weight numeric(12, 6) not null,
  enabled boolean not null default true,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint rule_definition_security_level check (security.is_valid_security_level(security_level)),
  constraint rule_definition_weight check (weight > 0),
  unique (tenant_id, project_id, rule_definition_id),
  unique (tenant_id, project_id, rule_key, rule_version)
);

create table if not exists quality.check_run (
  check_run_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid,
  version_id uuid,
  status text not null,
  deterministic boolean not null default true,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint check_run_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, check_run_id)
);

create table if not exists quality.issue (
  issue_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  check_run_id uuid not null,
  rule_definition_id uuid not null,
  severity text not null,
  status text not null default 'OPEN',
  field_path text,
  message text not null,
  evidence jsonb,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint quality_issue_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, check_run_id) references quality.check_run (tenant_id, project_id, check_run_id),
  foreign key (tenant_id, project_id, rule_definition_id) references quality.rule_definition (tenant_id, project_id, rule_definition_id),
  unique (tenant_id, project_id, issue_id)
);

create table if not exists quality.scorecard (
  scorecard_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  check_run_id uuid not null,
  score numeric(9, 6) not null,
  quality_grade text not null,
  acceptance_status text not null,
  blocking_rule_ids uuid[] not null default '{}',
  failed_rule_ids uuid[] not null default '{}',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint scorecard_security_level check (security.is_valid_security_level(security_level)),
  constraint scorecard_score check (score between 0 and 1),
  foreign key (tenant_id, project_id, check_run_id) references quality.check_run (tenant_id, project_id, check_run_id),
  unique (tenant_id, project_id, scorecard_id),
  unique (tenant_id, project_id, check_run_id)
);

create table if not exists lineage.process_run (
  process_run_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  ingestion_id uuid,
  operation_id uuid not null,
  process_type text not null,
  implementation_version text not null,
  input_manifest jsonb not null,
  output_manifest jsonb,
  status text not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint process_run_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, ingestion_id) references ingestion.session (tenant_id, project_id, ingestion_id),
  foreign key (tenant_id, project_id, operation_id) references service.operation (tenant_id, project_id, operation_id),
  unique (tenant_id, project_id, process_run_id)
);

create table if not exists lineage.edge (
  edge_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  process_run_id uuid not null,
  from_data_item_id uuid not null,
  from_version_id uuid not null,
  to_data_item_id uuid not null,
  to_version_id uuid not null,
  relation_type text not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint lineage_edge_security_level check (security.is_valid_security_level(security_level)),
  foreign key (tenant_id, project_id, process_run_id) references lineage.process_run (tenant_id, project_id, process_run_id),
  foreign key (tenant_id, project_id, from_data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, from_version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  foreign key (tenant_id, project_id, to_data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, to_version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, edge_id),
  unique (tenant_id, project_id, from_version_id, to_version_id, relation_type)
);

create table if not exists knowledge.evidence_fragment (
  evidence_fragment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_id uuid not null,
  asset_id uuid,
  locator jsonb not null,
  content_hash bytea not null,
  excerpt text,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint evidence_fragment_security_level check (security.is_valid_security_level(security_level)),
  constraint evidence_fragment_hash check (octet_length(content_hash) = 32),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  foreign key (tenant_id, project_id, asset_id) references catalog.asset (tenant_id, project_id, asset_id),
  unique (tenant_id, project_id, evidence_fragment_id)
);

create table if not exists knowledge.assertion (
  assertion_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  evidence_fragment_id uuid not null,
  subject jsonb not null,
  predicate text not null,
  object jsonb not null,
  confidence numeric(7, 6) not null,
  generation_method text not null,
  status text not null default 'PENDING_REVIEW',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_assertion_security_level check (security.is_valid_security_level(security_level)),
  constraint knowledge_assertion_confidence check (confidence between 0 and 1),
  foreign key (tenant_id, project_id, evidence_fragment_id) references knowledge.evidence_fragment (tenant_id, project_id, evidence_fragment_id),
  unique (tenant_id, project_id, assertion_id)
);

create table if not exists knowledge.review_record (
  review_record_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  assertion_id uuid not null,
  reviewer_actor_id uuid not null,
  decision text not null,
  rationale text,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_review_security_level check (security.is_valid_security_level(security_level)),
  constraint knowledge_review_decision check (decision in ('APPROVED', 'REJECTED', 'CORRECTION_REQUIRED')),
  foreign key (tenant_id, project_id, assertion_id) references knowledge.assertion (tenant_id, project_id, assertion_id),
  unique (tenant_id, project_id, review_record_id)
);

create table if not exists service.operation_event (
  operation_event_id bigint generated always as identity primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  operation_id uuid not null,
  event_id uuid not null default gen_random_uuid(),
  sequence_number bigint not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  payload jsonb not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  constraint operation_event_security_level check (security.is_valid_security_level(security_level)),
  constraint operation_event_immutable check (row_version = 1),
  foreign key (tenant_id, project_id, operation_id) references service.operation (tenant_id, project_id, operation_id),
  unique (tenant_id, project_id, operation_event_id),
  unique (tenant_id, project_id, event_id),
  unique (tenant_id, project_id, operation_id, sequence_number)
);

create table if not exists service.projection_status (
  projection_status_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  data_item_id uuid not null,
  version_id uuid not null,
  projection_kind text not null,
  status text not null default 'PENDING',
  idempotency_key text not null,
  attempt_count integer not null default 0,
  projected_at timestamptz,
  error_detail jsonb,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint projection_status_security_level check (security.is_valid_security_level(security_level)),
  constraint projection_status_state check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  foreign key (tenant_id, project_id, data_item_id) references catalog.data_item (tenant_id, project_id, data_item_id),
  foreign key (tenant_id, project_id, version_id) references catalog.data_item_version (tenant_id, project_id, version_id),
  unique (tenant_id, project_id, projection_status_id),
  unique (tenant_id, project_id, version_id, projection_kind),
  unique (tenant_id, project_id, idempotency_key)
);

create table if not exists security.policy (
  policy_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  policy_name text not null,
  document jsonb not null,
  enabled boolean not null default true,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint security_policy_security_level check (security.is_valid_security_level(security_level)),
  unique (tenant_id, project_id, policy_id),
  unique (tenant_id, project_id, policy_name, policy_version)
);

create table if not exists security.policy_binding (
  policy_binding_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  policy_id uuid not null,
  subject_type text not null,
  subject_id text not null,
  resource_type text not null,
  resource_id text,
  effect text not null,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint policy_binding_security_level check (security.is_valid_security_level(security_level)),
  constraint policy_binding_effect check (effect in ('ALLOW', 'DENY')),
  foreign key (tenant_id, project_id, policy_id) references security.policy (tenant_id, project_id, policy_id),
  unique (tenant_id, project_id, policy_binding_id)
);

create table if not exists security.audit_event (
  audit_event_id bigint generated always as identity primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  event_id uuid not null default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  decision text not null,
  purpose text,
  context jsonb not null default '{}',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  constraint audit_event_security_level check (security.is_valid_security_level(security_level)),
  constraint audit_event_immutable check (row_version = 1),
  unique (tenant_id, project_id, audit_event_id),
  unique (tenant_id, project_id, event_id)
);

create table if not exists event.outbox_event (
  outbox_event_id bigint generated always as identity primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  event_id uuid not null default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  headers jsonb not null default '{}',
  idempotency_key text not null,
  available_at timestamptz not null default clock_timestamp(),
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  constraint outbox_event_security_level check (security.is_valid_security_level(security_level)),
  constraint outbox_event_immutable check (row_version = 1),
  unique (tenant_id, project_id, outbox_event_id),
  unique (tenant_id, project_id, event_id),
  unique (tenant_id, project_id, idempotency_key)
);

create table if not exists event.consumer_checkpoint (
  consumer_checkpoint_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  consumer_name text not null,
  partition_key text not null default 'default',
  last_outbox_event_id bigint not null default 0,
  last_event_id uuid,
  last_error jsonb,
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint consumer_checkpoint_security_level check (security.is_valid_security_level(security_level)),
  constraint consumer_checkpoint_position check (last_outbox_event_id >= 0),
  unique (tenant_id, project_id, consumer_checkpoint_id),
  unique (tenant_id, project_id, consumer_name, partition_key)
);

create index data_item_scope_idx on catalog.data_item (tenant_id, project_id, security_level, updated_at);
create index data_item_business_domains_idx on catalog.data_item using gin (business_domains);
create index data_item_intended_uses_idx on catalog.data_item using gin (intended_uses);
create index data_item_version_data_item_idx on catalog.data_item_version (data_item_id, version_number desc);
create index asset_version_id_idx on catalog.asset (version_id);
create index schema_version_data_item_id_idx on catalog.schema_version (data_item_id);
create index field_definition_schema_version_id_idx on catalog.field_definition (schema_version_id);
create index source_provenance_data_item_id_idx on catalog.source_provenance (data_item_id);
create index source_provenance_version_id_idx on catalog.source_provenance (version_id);
create index spatial_extent_data_item_id_idx on catalog.spatial_extent (data_item_id);
create index spatial_extent_version_id_idx on catalog.spatial_extent (version_id);
create index spatial_extent_canonical_gist_idx on catalog.spatial_extent using gist (canonical_geometry);
create index temporal_extent_data_item_id_idx on catalog.temporal_extent (data_item_id);
create index temporal_extent_version_id_idx on catalog.temporal_extent (version_id);
create index operation_scope_status_idx on service.operation (tenant_id, project_id, status, created_at);
create index ingestion_session_operation_id_idx on ingestion.session (operation_id);
create index input_asset_ingestion_id_idx on ingestion.input_asset (ingestion_id);
create index input_asset_asset_id_idx on ingestion.input_asset (asset_id);
create index agent_run_ingestion_id_idx on ingestion.agent_run (ingestion_id);
create index agent_action_agent_run_id_idx on ingestion.agent_action (agent_run_id);
create index transform_plan_ingestion_id_idx on ingestion.transform_plan (ingestion_id);
create index ingestion_review_ingestion_id_idx on ingestion.review (ingestion_id);
create index ingestion_job_ingestion_id_idx on ingestion.job (ingestion_id);
create index ingestion_job_operation_id_idx on ingestion.job (operation_id);
create index ingestion_job_depends_on_job_id_idx on ingestion.job (depends_on_job_id);
create index ingestion_job_claim_idx on ingestion.job (tenant_id, project_id, priority desc, next_attempt_at, created_at) where status in ('PENDING', 'RETRY_SCHEDULED');
create index job_attempt_job_id_idx on ingestion.job_attempt (job_id);
create index check_run_ingestion_id_idx on quality.check_run (ingestion_id);
create index check_run_version_id_idx on quality.check_run (version_id);
create index quality_issue_check_run_id_idx on quality.issue (check_run_id);
create index quality_issue_rule_definition_id_idx on quality.issue (rule_definition_id);
create index scorecard_check_run_id_idx on quality.scorecard (check_run_id);
create index process_run_ingestion_id_idx on lineage.process_run (ingestion_id);
create index process_run_operation_id_idx on lineage.process_run (operation_id);
create index lineage_edge_process_run_id_idx on lineage.edge (process_run_id);
create index evidence_fragment_version_id_idx on knowledge.evidence_fragment (version_id);
create index assertion_evidence_fragment_id_idx on knowledge.assertion (evidence_fragment_id);
create index review_record_assertion_id_idx on knowledge.review_record (assertion_id);
create index capability_version_capability_record_id_idx on service.capability_version (capability_record_id);
create index operation_event_operation_id_idx on service.operation_event (operation_id, sequence_number);
create index operation_event_created_brin_idx on service.operation_event using brin (created_at);
create index projection_status_data_item_id_idx on service.projection_status (data_item_id);
create index projection_status_version_id_idx on service.projection_status (version_id);
create index policy_binding_policy_id_idx on security.policy_binding (policy_id);
create index audit_event_created_brin_idx on security.audit_event using brin (created_at);
create index outbox_event_available_idx on event.outbox_event (tenant_id, project_id, available_at, outbox_event_id);
create index outbox_event_created_brin_idx on event.outbox_event using brin (created_at);
