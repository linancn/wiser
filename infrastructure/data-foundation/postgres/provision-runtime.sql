\set ON_ERROR_STOP on

begin;

select format(
  'create role wiser_data_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_runtime'
) \gexec

-- Dedicated metadata reader: no content-table grants and no inherited runtime
-- privileges when the API switches to this role inside a private transaction.
select format(
  'create role wiser_data_metadata NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_metadata'
) \gexec

select format(
  'create role wiser_data_api LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'api_password'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_api'
) \gexec

select format(
  'create role wiser_data_worker LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'worker_password'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_worker'
) \gexec

select format(
  'create role wiser_data_gis LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'gis_password'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_gis'
) \gexec

alter role wiser_data_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
alter role wiser_data_metadata NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

select format(
  'alter role wiser_data_api LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'api_password'
) \gexec

select format(
  'alter role wiser_data_worker LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'worker_password'
) \gexec

select format(
  'alter role wiser_data_gis LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'gis_password'
) \gexec

grant wiser_data_runtime to wiser_data_api;
grant wiser_data_runtime to wiser_data_worker;
grant wiser_data_metadata to wiser_data_api with inherit false, set true;

alter role wiser_data_api set search_path = public;
alter role wiser_data_api set statement_timeout = '120s';
alter role wiser_data_api set idle_in_transaction_session_timeout = '30s';
alter role wiser_data_worker set search_path = public;
alter role wiser_data_worker set statement_timeout = '15min';
alter role wiser_data_worker set idle_in_transaction_session_timeout = '30s';
alter role wiser_data_gis set search_path = service, public;
alter role wiser_data_gis set statement_timeout = '10s';
alter role wiser_data_gis set idle_in_transaction_session_timeout = '10s';

grant connect on database wiser_data to wiser_data_runtime;
grant connect on database wiser_data to wiser_data_metadata;
grant connect on database wiser_data to wiser_data_gis;
grant usage on schema service to wiser_data_gis;
grant execute on function service.wiser_spatial_extent_mvt(
  integer,
  integer,
  integer,
  json
) to wiser_data_gis;
grant execute on function service.wiser_exploration_mvt(integer, integer, integer, json) to wiser_data_gis;
grant execute on function service.wiser_exploration_amap_mvt(integer, integer, integer, json) to wiser_data_gis;
grant execute on function service.wiser_spatial_extent_amap_mvt(integer, integer, integer, json) to wiser_data_gis;
revoke all on all tables in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
from wiser_data_gis;
grant usage on schema public to wiser_data_runtime;
grant select on table public.schema_migrations to wiser_data_runtime;

grant usage on schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
to wiser_data_runtime;

grant select, insert, update on all tables in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
to wiser_data_runtime;

revoke delete, truncate, references, trigger on all tables in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
from wiser_data_runtime;

grant usage, select on all sequences in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
to wiser_data_runtime;

grant execute on all functions in schema ingestion, security to wiser_data_runtime;

alter default privileges in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
grant select, insert, update on tables to wiser_data_runtime;

alter default privileges in schema
  catalog,
  ingestion,
  quality,
  lineage,
  knowledge,
  service,
  security,
  event
grant usage, select on sequences to wiser_data_runtime;

alter default privileges in schema ingestion, security
grant execute on functions to wiser_data_runtime;

-- Query manifests are immutable, expiring caches owned by the verified caller.
do $$ begin
  if to_regclass('knowledge.assertion_binding') is not null then
    revoke update,delete on knowledge.assertion_binding from wiser_data_runtime;
  end if;
  if to_regclass('service.intake_assessment') is not null then
    revoke update,delete on service.intake_assessment from wiser_data_runtime;
  end if;
  if to_regclass('service.observation_reconciliation') is not null then
    revoke update on service.observation_reconciliation from wiser_data_runtime;
    grant update(status,row_version,reviewed_at,review_note) on service.observation_reconciliation to wiser_data_runtime;
  end if;
  if to_regclass('service.exploration_saved_view') is not null then
    grant select,insert on service.exploration_saved_view to wiser_data_runtime;
    revoke update,delete on service.exploration_saved_view from wiser_data_runtime;
    grant update(revoked_at) on service.exploration_saved_view to wiser_data_runtime;
  end if;
  if to_regprocedure('service.valid_exploration_business_pins(jsonb)') is not null then
    grant execute on function service.valid_exploration_business_pins(jsonb) to wiser_data_runtime;
  end if;
  if to_regclass('service.exploration_snapshot') is not null then
    grant select, insert, delete on service.exploration_snapshot to wiser_data_runtime;
    revoke update on service.exploration_snapshot from wiser_data_runtime;
  end if;
  if to_regclass('security.relation_entity_definition') is not null then
    revoke all on security.relation_entity_definition from wiser_data_runtime;
    revoke execute on function security.guard_relation_entity_definition() from wiser_data_runtime;
  end if;
end $$;

revoke all on service.analysis_amap_geometry from wiser_data_runtime;

-- Only these columns may be read by the management catalog. RLS still limits
-- tenant, project, security level and policy version. No asset, evidence,
-- manifest, source contact or search-index grant is given. The authorization
-- scope is read only to exclude ineligible versions and is never returned.
revoke all on all tables in schema
  catalog, ingestion, quality, lineage, knowledge, service, security, event
from wiser_data_metadata;
grant usage on schema catalog, security to wiser_data_metadata;
grant select (
  tenant_id, project_id, data_item_id, name, source_organization,
  publication_status, acceptance_status, security_level, policy_version,
  authorization_scope
) on catalog.data_item to wiser_data_metadata;
grant select (
  tenant_id, project_id, data_item_id, version_id, version_number,
  publication_status, acceptance_status, security_level, policy_version,
  processing_stage, committed_at
) on catalog.data_item_version to wiser_data_metadata;
grant execute on function security.resource_scope_legacy() to wiser_data_metadata;
grant execute on function security.resource_version_members() to wiser_data_metadata;
-- PostgreSQL checks the function privilege in the catalog item's RLS policy
-- even when its legacy branch is selected. Keep invoker and column limits.
grant execute on function security.resource_related_ids(text) to wiser_data_metadata;
grant execute on function security.authorized_row(uuid,uuid,text,bigint) to wiser_data_metadata;
grant execute on function security.current_tenant_id(),
  security.current_project_id(), security.current_max_security_level(),
  security.current_policy_version() to wiser_data_metadata;
grant execute on function security.security_rank(text) to wiser_data_metadata;

commit;
