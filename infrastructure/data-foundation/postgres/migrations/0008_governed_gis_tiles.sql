-- Martin discovers this function as a single governed vector-tile source.
-- It intentionally owns no identity semantics: the public API resolves a
-- Supabase principal, reauthorizes the requested immutable version through
-- data-postgres RLS, and supplies the five fixed query parameters below.

create or replace function service.wiser_spatial_extent_mvt(
  z integer,
  x integer,
  y integer,
  query_params json
)
returns bytea
language plpgsql
stable
security definer
parallel restricted
set search_path = pg_catalog, public
as $$
declare
  requested_tenant_id uuid;
  requested_project_id uuid;
  requested_version_id uuid;
  requested_max_security_level text;
  requested_policy_version bigint;
  tile bytea;
begin
  if z < 0 or z > 22
    or x < 0 or y < 0
    or x >= (1 << z) or y >= (1 << z)
    or json_typeof(query_params) <> 'object'
    or (select count(*) from json_object_keys(query_params)) <> 5
    or exists (
      select 1
      from json_object_keys(query_params) as supplied(key)
      where supplied.key not in (
        'tenantId',
        'projectId',
        'versionId',
        'maxSecurityLevel',
        'policyVersion'
      )
    ) then
    raise exception 'invalid governed tile request'
      using errcode = '22023';
  end if;

  requested_tenant_id := nullif(query_params ->> 'tenantId', '')::uuid;
  requested_project_id := nullif(query_params ->> 'projectId', '')::uuid;
  requested_version_id := nullif(query_params ->> 'versionId', '')::uuid;
  requested_max_security_level :=
    nullif(query_params ->> 'maxSecurityLevel', '');
  requested_policy_version :=
    nullif(query_params ->> 'policyVersion', '')::bigint;

  if requested_tenant_id is null
    or requested_project_id is null
    or requested_version_id is null
    or security.security_rank(requested_max_security_level) is null
    or requested_policy_version is null
    or requested_policy_version < 1 then
    raise exception 'invalid governed tile scope'
      using errcode = '22023';
  end if;

  select public.st_asmvt(rows, 'authority', 4096, 'geom')
  into tile
  from (
    select
      extent.spatial_extent_id::text as feature_id,
      extent.data_item_id::text as data_item_id,
      extent.version_id::text as version_id,
      extent.source_crs,
      extent.canonical_crs,
      public.st_asmvtgeom(
        coalesce(
          extent.display_geometry,
          public.st_transform(extent.canonical_geometry, 3857)
        ),
        public.st_tileenvelope(z, x, y),
        4096,
        64,
        true
      ) as geom
    from catalog.spatial_extent as extent
    join catalog.data_item_version as version
      on version.tenant_id = extent.tenant_id
     and version.project_id = extent.project_id
     and version.version_id = extent.version_id
    where extent.tenant_id = requested_tenant_id
      and extent.project_id = requested_project_id
      and extent.version_id = requested_version_id
      and version.tenant_id = requested_tenant_id
      and version.project_id = requested_project_id
      and version.version_id = requested_version_id
      and version.committed_at is not null
      and extent.policy_version <= requested_policy_version
      and version.policy_version <= requested_policy_version
      and security.security_rank(extent.security_level)
        <= security.security_rank(requested_max_security_level)
      and security.security_rank(version.security_level)
        <= security.security_rank(requested_max_security_level)
      and coalesce(
        extent.display_geometry,
        public.st_transform(extent.canonical_geometry, 3857)
      ) && public.st_tileenvelope(z, x, y)
  ) as rows
  where rows.geom is not null;

  return coalesce(tile, '\x'::bytea);
end;
$$;

revoke all on function service.wiser_spatial_extent_mvt(
  integer,
  integer,
  integer,
  json
) from public;
