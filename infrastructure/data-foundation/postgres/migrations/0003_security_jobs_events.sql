create or replace function security.current_tenant_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('wiser.tenant_id', true), '')::uuid;
$$;

create or replace function security.current_project_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('wiser.project_id', true), '')::uuid;
$$;

create or replace function security.current_max_security_level()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('wiser.max_security_level', true), '');
$$;

create or replace function security.current_policy_version()
returns bigint
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('wiser.policy_version', true), '')::bigint;
$$;

create or replace function security.authorized_row(
  row_tenant_id uuid,
  row_project_id uuid,
  row_security_level text,
  row_policy_version bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select row_tenant_id = security.current_tenant_id()
    and row_project_id = security.current_project_id()
    and security.security_rank(row_security_level)
      <= security.security_rank(security.current_max_security_level())
    and row_policy_version <= security.current_policy_version();
$$;

alter table catalog.data_item enable row level security;
alter table catalog.data_item force row level security;
alter table catalog.data_item_version enable row level security;
alter table catalog.data_item_version force row level security;
alter table catalog.asset enable row level security;
alter table catalog.asset force row level security;
alter table catalog.schema_version enable row level security;
alter table catalog.schema_version force row level security;
alter table catalog.field_definition enable row level security;
alter table catalog.field_definition force row level security;
alter table catalog.source_provenance enable row level security;
alter table catalog.source_provenance force row level security;
alter table catalog.spatial_extent enable row level security;
alter table catalog.spatial_extent force row level security;
alter table catalog.temporal_extent enable row level security;
alter table catalog.temporal_extent force row level security;
alter table ingestion.session enable row level security;
alter table ingestion.session force row level security;
alter table ingestion.input_asset enable row level security;
alter table ingestion.input_asset force row level security;
alter table ingestion.agent_run enable row level security;
alter table ingestion.agent_run force row level security;
alter table ingestion.agent_action enable row level security;
alter table ingestion.agent_action force row level security;
alter table ingestion.transform_plan enable row level security;
alter table ingestion.transform_plan force row level security;
alter table ingestion.review enable row level security;
alter table ingestion.review force row level security;
alter table ingestion.job enable row level security;
alter table ingestion.job force row level security;
alter table ingestion.job_attempt enable row level security;
alter table ingestion.job_attempt force row level security;
alter table quality.rule_definition enable row level security;
alter table quality.rule_definition force row level security;
alter table quality.check_run enable row level security;
alter table quality.check_run force row level security;
alter table quality.issue enable row level security;
alter table quality.issue force row level security;
alter table quality.scorecard enable row level security;
alter table quality.scorecard force row level security;
alter table lineage.process_run enable row level security;
alter table lineage.process_run force row level security;
alter table lineage.edge enable row level security;
alter table lineage.edge force row level security;
alter table knowledge.evidence_fragment enable row level security;
alter table knowledge.evidence_fragment force row level security;
alter table knowledge.assertion enable row level security;
alter table knowledge.assertion force row level security;
alter table knowledge.review_record enable row level security;
alter table knowledge.review_record force row level security;
alter table service.capability enable row level security;
alter table service.capability force row level security;
alter table service.capability_version enable row level security;
alter table service.capability_version force row level security;
alter table service.operation enable row level security;
alter table service.operation force row level security;
alter table service.operation_event enable row level security;
alter table service.operation_event force row level security;
alter table service.projection_status enable row level security;
alter table service.projection_status force row level security;
alter table security.policy enable row level security;
alter table security.policy force row level security;
alter table security.policy_binding enable row level security;
alter table security.policy_binding force row level security;
alter table security.audit_event enable row level security;
alter table security.audit_event force row level security;
alter table event.outbox_event enable row level security;
alter table event.outbox_event force row level security;
alter table event.consumer_checkpoint enable row level security;
alter table event.consumer_checkpoint force row level security;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'catalog.data_item',
    'catalog.data_item_version',
    'catalog.asset',
    'catalog.schema_version',
    'catalog.field_definition',
    'catalog.source_provenance',
    'catalog.spatial_extent',
    'catalog.temporal_extent',
    'ingestion.session',
    'ingestion.input_asset',
    'ingestion.agent_run',
    'ingestion.agent_action',
    'ingestion.transform_plan',
    'ingestion.review',
    'ingestion.job',
    'ingestion.job_attempt',
    'quality.rule_definition',
    'quality.check_run',
    'quality.issue',
    'quality.scorecard',
    'lineage.process_run',
    'lineage.edge',
    'knowledge.evidence_fragment',
    'knowledge.assertion',
    'knowledge.review_record',
    'service.capability',
    'service.capability_version',
    'service.operation',
    'service.operation_event',
    'service.projection_status',
    'security.policy',
    'security.policy_binding',
    'security.audit_event',
    'event.outbox_event',
    'event.consumer_checkpoint'
  ]
  loop
    execute format('drop policy if exists data_scope on %s', relation_name);
    execute format(
      'create policy data_scope on %s using (security.authorized_row(tenant_id, project_id, security_level, policy_version)) with check (security.authorized_row(tenant_id, project_id, security_level, policy_version))',
      relation_name
    );
  end loop;
end;
$$;

create or replace function event.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'append-only relation % cannot be mutated', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end;
$$;

create trigger operation_event_append_only
before update or delete on service.operation_event
for each row execute function event.reject_append_only_mutation();

create trigger outbox_event_append_only
before update or delete on event.outbox_event
for each row execute function event.reject_append_only_mutation();

create trigger audit_event_append_only
before update or delete on security.audit_event
for each row execute function event.reject_append_only_mutation();

create trigger data_item_version_immutable
before update or delete on catalog.data_item_version
for each row execute function event.reject_append_only_mutation();

create trigger asset_content_immutable
before update of storage_key, content_hash, media_type, byte_size or delete on catalog.asset
for each row execute function event.reject_append_only_mutation();

-- Durable manual/dead states: 'WAITING_INPUT', 'WAITING_REVIEW', 'DEAD_LETTER'.
create or replace function ingestion.claim_jobs(
  requested_tenant_id uuid,
  requested_project_id uuid,
  worker_id text,
  lease_duration interval,
  batch_size integer default 1
)
returns setof ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
begin
  if requested_tenant_id is distinct from security.current_tenant_id()
     or requested_project_id is distinct from security.current_project_id() then
    raise exception 'job claim scope does not match the authorized database context'
      using errcode = '42501';
  end if;
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  if lease_duration <= interval '0 seconds'
     or batch_size < 1
     or batch_size > 100 then
    raise exception 'invalid lease duration or batch size' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select candidate.job_id
    from ingestion.job as candidate
    where candidate.tenant_id = requested_tenant_id
      and candidate.project_id = requested_project_id
      and candidate.cancel_requested_at is null
      and candidate.attempt_count < candidate.max_attempts
      and candidate.next_attempt_at <= clock_timestamp()
      and (candidate.timeout_at is null or candidate.timeout_at > clock_timestamp())
      and (
        candidate.status in ('PENDING', 'RETRY_SCHEDULED')
        or (
          candidate.status = 'RUNNING'
          and candidate.lease_expires_at < clock_timestamp()
        )
      )
      and (
        candidate.depends_on_job_id is null
        or exists (
          select 1
          from ingestion.job as dependency
          where dependency.job_id = candidate.depends_on_job_id
            and dependency.tenant_id = candidate.tenant_id
            and dependency.project_id = candidate.project_id
            and dependency.status = 'SUCCEEDED'
        )
      )
    order by candidate.priority desc, candidate.next_attempt_at, candidate.created_at
    for update skip locked
    limit batch_size
  )
  update ingestion.job as claimed
  set status = 'RUNNING',
      lease_owner = worker_id,
      lease_expires_at = clock_timestamp() + lease_duration,
      heartbeat_at = clock_timestamp(),
      attempt_count = claimed.attempt_count + 1,
      row_version = claimed.row_version + 1,
      updated_at = clock_timestamp()
  from candidates
  where claimed.job_id = candidates.job_id
  returning claimed.*;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select table_schema, table_name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('catalog', 'ingestion', 'quality', 'lineage', 'knowledge', 'service', 'security', 'event')
  loop
    execute format(
      'create index if not exists %I on %I.%I (tenant_id, project_id, security_level, policy_version)',
      target.table_name || '_scope_security_idx',
      target.table_schema,
      target.table_name
    );
  end loop;
end;
$$;

revoke all on all tables in schema catalog, ingestion, quality, lineage, knowledge, service, security, event from public;
revoke all on all sequences in schema catalog, ingestion, quality, lineage, knowledge, service, security, event from public;
revoke all on all functions in schema ingestion, security, event from public;
alter default privileges in schema ingestion revoke execute on functions from public;
alter default privileges in schema security revoke execute on functions from public;
alter default privileges in schema event revoke execute on functions from public;
