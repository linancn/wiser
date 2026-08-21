-- WISER Data Foundation owns this database. Supabase remains the identity and
-- control-plane authority and is never written from these migrations.

create extension if not exists pgcrypto;
create extension if not exists postgis;
create extension if not exists btree_gist;
create extension if not exists unaccent;

create schema if not exists catalog;
create schema if not exists ingestion;
create schema if not exists quality;
create schema if not exists lineage;
create schema if not exists knowledge;
create schema if not exists service;
create schema if not exists security;
create schema if not exists event;

revoke all on schema catalog from public;
revoke all on schema ingestion from public;
revoke all on schema quality from public;
revoke all on schema lineage from public;
revoke all on schema knowledge from public;
revoke all on schema service from public;
revoke all on schema security from public;
revoke all on schema event from public;

create table if not exists public.schema_migrations (
  version text primary key,
  filename text not null unique,
  checksum text not null,
  applied_at timestamptz not null default clock_timestamp(),
  constraint schema_migrations_version_format check (version ~ '^[0-9]{4}$'),
  constraint schema_migrations_checksum_format check (checksum ~ '^[a-f0-9]{64}$')
);

create or replace function security.is_valid_security_level(candidate text)
returns boolean
language sql
immutable
parallel safe
as $$
  select candidate in ('L0_PUBLIC', 'L1_INTERNAL', 'L2_RESTRICTED', 'L3_CONFIDENTIAL');
$$;

create or replace function security.security_rank(candidate text)
returns smallint
language sql
immutable
parallel safe
as $$
  select case candidate
    when 'L0_PUBLIC' then 0
    when 'L1_INTERNAL' then 1
    when 'L2_RESTRICTED' then 2
    when 'L3_CONFIDENTIAL' then 3
    else null
  end::smallint;
$$;

-- pgSTAC is distributed as versioned SQL installed by the official pyPgSTAC
-- migrator; it is not a PostgreSQL CREATE EXTENSION named pgstac. Its required
-- PostGIS, btree_gist and unaccent extensions are initialized above. Deployment
-- runs `pypgstac migrate`; this guard accepts absence before that external step
-- but rejects a partially initialized schema.
do $$
begin
  if to_regnamespace('pgstac') is not null
     and (
       to_regclass('pgstac.collections') is null
       or to_regclass('pgstac.items') is null
     ) then
    raise exception
      'Partial pgSTAC schema detected; repair it with the pinned pypgstac migrate command';
  elsif to_regnamespace('pgstac') is null then
    raise notice
      'pgSTAC pending: initialize with the pinned pypgstac migrate command before STAC projection traffic';
  end if;
end;
$$;
