\set ON_ERROR_STOP on

begin;

select format(
  'create role wiser_data_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'wiser_data_runtime'
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
grant connect on database wiser_data to wiser_data_gis;
grant usage on schema service to wiser_data_gis;
grant execute on function service.wiser_spatial_extent_mvt(
  integer,
  integer,
  integer,
  json
) to wiser_data_gis;
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

commit;
