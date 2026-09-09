/*
MIT License

Copyright (c) 2018-present, Jiulong Hu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
-- Display-only GCJ-02 coordinates; original WGS84 authority remains immutable.
-- Coordinate arithmetic adapted from gcoord 1.0.7 (MIT), hujiulong.
create function service.amap_display_point(point geometry)
returns geometry language plpgsql immutable strict parallel safe
set search_path=pg_catalog,public as $$
declare
  lon float8 := public.st_x(point); lat float8 := public.st_y(point);
  dx float8; dy float8; px float8; py float8; magic float8; root_magic float8;
  angle float8; earth float8 := 6378245; eccentricity float8 := 0.006693421622965823;
begin
  if public.st_srid(point)<>4326 or lon not between -180 and 180 or lat not between -90 and 90
    then raise exception 'invalid authority coordinate' using errcode='22023'; end if;
  if lon not between 72.004 and 137.8347 or lat not between 0.8293 and 55.8271
    then return public.st_makepoint(lon,lat); end if;
  px := lon-105; py := lat-35;
  dy := -100+2*px+3*py+0.2*py*py+0.1*px*py+0.2*sqrt(abs(px));
  dy := dy+(20*sin(6*px*pi())+20*sin(2*px*pi()))*2/3;
  dy := dy+(20*sin(py*pi())+40*sin(py*pi()/3))*2/3;
  dy := dy+(160*sin(py*pi()/12)+320*sin(py*pi()/30))*2/3;
  dx := 300+px+2*py+0.1*px*px+0.1*px*py+0.1*sqrt(abs(px));
  dx := dx+(20*sin(6*px*pi())+20*sin(2*px*pi()))*2/3;
  dx := dx+(20*sin(px*pi())+40*sin(px*pi()/3))*2/3;
  dx := dx+(150*sin(px*pi()/12)+300*sin(px*pi()/30))*2/3;
  angle := lat*pi()/180;
  magic := 1-eccentricity*sin(angle)*sin(angle); root_magic := sqrt(magic);
  dx := dx*180/((earth/root_magic)*cos(angle)*pi());
  dy := dy*180/((earth*(1-eccentricity)/(magic*root_magic))*pi());
  return public.st_makepoint(lon+dx,lat+dy);
end $$;

create function service.amap_coordinate_tree(value jsonb)
returns jsonb language plpgsql immutable strict parallel safe
set search_path=pg_catalog,public as $$
declare result jsonb; point geometry;
begin
  if jsonb_typeof(value)<>'array' then raise exception 'invalid coordinate tree'; end if;
  if jsonb_typeof(value->0)='number' then
    point := service.amap_display_point(public.st_setsrid(public.st_makepoint((value->>0)::float8,(value->>1)::float8),4326));
    return jsonb_build_array(public.st_x(point),public.st_y(point));
  end if;
  select coalesce(jsonb_agg(service.amap_coordinate_tree(part) order by ordinal),'[]'::jsonb)
    into result from jsonb_array_elements(value) with ordinality as entries(part,ordinal);
  return result;
end $$;

create function service.amap_geometry_json(value jsonb)
returns jsonb language plpgsql immutable strict parallel safe
set search_path=pg_catalog,public as $$
declare children jsonb;
begin
  if value->>'type'='GeometryCollection' then
    select coalesce(jsonb_agg(service.amap_geometry_json(part) order by ordinal),'[]'::jsonb)
      into children from jsonb_array_elements(value->'geometries') with ordinality as entries(part,ordinal);
    return jsonb_set(value,'{geometries}',children);
  end if;
  return jsonb_set(value,'{coordinates}',service.amap_coordinate_tree(value->'coordinates'));
end $$;

create function service.amap_webmercator_geometry(authority geometry)
returns geometry language plpgsql immutable strict parallel safe
set search_path=pg_catalog,public as $$
declare bounded geometry; display geometry;
begin
  if public.st_srid(authority)<>4326 then raise exception 'unsupported authority CRS' using errcode='22023'; end if;
  if public.geometrytype(authority)='POINT' then
    if abs(public.st_y(authority))>85.0511287798066 then return null; end if;
    return public.st_transform(public.st_setsrid(service.amap_display_point(authority),4326),3857);
  end if;
  bounded := public.st_intersection(public.st_force2d(authority),public.st_makeenvelope(-180,-85.0511287798066,180,85.0511287798066,4326));
  if public.st_isempty(bounded) then return null; end if;
  -- Densify before the nonlinear shift; original vertices and source data are untouched.
  display := public.st_geomfromgeojson(service.amap_geometry_json(public.st_asgeojson(public.st_segmentize(bounded,0.01),15,0)::jsonb));
  -- 4326 here supplies Mercator arithmetic for display degrees, not a datum claim.
  return public.st_transform(public.st_setsrid(display,4326),3857);
end $$;

create table service.analysis_amap_geometry (
  analysis_id uuid not null,
  record_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version>0),
  geom geometry(Geometry,3857) not null,
  primary key(analysis_id,record_id),
  foreign key(analysis_id,record_id) references catalog.analysis_record(analysis_id,record_id)
);
comment on table service.analysis_amap_geometry is 'Rebuildable AMap display projection; GCJ-02 Mercator plane, never source CRS authority';
alter table service.analysis_amap_geometry enable row level security;
alter table service.analysis_amap_geometry force row level security;
create policy amap_scope on service.analysis_amap_geometry using(security.authorized_row(tenant_id,project_id,security_level,policy_version));
revoke all on service.analysis_amap_geometry from public;
create index analysis_amap_geometry_gist on service.analysis_amap_geometry using gist(geom);

create function service.project_analysis_amap_geometry()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare display geometry;
begin
  display := service.amap_webmercator_geometry(new.geom);
  if display is not null then
    insert into service.analysis_amap_geometry(analysis_id,record_id,tenant_id,project_id,security_level,policy_version,geom)
      values(new.analysis_id,new.record_id,new.tenant_id,new.project_id,new.security_level,new.policy_version,display);
  end if;
  return new;
end $$;
create trigger analysis_amap_projection after insert on catalog.analysis_record
  for each row when(new.geom is not null) execute function service.project_analysis_amap_geometry();

insert into service.analysis_amap_geometry(analysis_id,record_id,tenant_id,project_id,security_level,policy_version,geom)
select analysis_id,record_id,tenant_id,project_id,security_level,policy_version,service.amap_webmercator_geometry(geom)
from catalog.analysis_record where geom is not null and service.amap_webmercator_geometry(geom) is not null;

revoke all on function service.amap_display_point(geometry) from public;
revoke all on function service.amap_coordinate_tree(jsonb) from public;
revoke all on function service.amap_geometry_json(jsonb) from public;
revoke all on function service.amap_webmercator_geometry(geometry) from public;
revoke all on function service.project_analysis_amap_geometry() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
    revoke all on service.analysis_amap_geometry from wiser_data_runtime;
  end if;
end $$;

-- Apply immutable geographic and record conditions before tile selection and clustering.
create or replace function service.wiser_exploration_mvt_display(z integer, x integer, y integer, query_params json, use_amap boolean)
returns bytea language plpgsql stable security definer parallel restricted
set search_path = pg_catalog, public
as $$
declare
  tenant uuid; project uuid; actor uuid; query uuid;
  requested_purpose text; ceiling text; policy bigint; refs jsonb; record_query jsonb; spatial_bounds jsonb; spatial_envelope geometry;
  authorized_count integer; bounds geometry; geographic_bounds geometry;
  cell_size double precision; tile bytea;
begin
  if z is null or x is null or y is null or z < 0 or z > 22
    or x < 0 or y < 0 or x >= (1 << z) or y >= (1 << z)
    or query_params is null or json_typeof(query_params) is distinct from 'object'
    or (select count(*) from json_object_keys(query_params)) <> 7
    or exists(select 1 from json_object_keys(query_params) k where k not in
      ('tenantId','projectId','actorId','queryId','purpose','maxSecurityLevel','policyVersion'))
  then raise exception 'invalid governed query tile request' using errcode='22023'; end if;
  tenant := nullif(query_params->>'tenantId','')::uuid;
  project := nullif(query_params->>'projectId','')::uuid;
  actor := nullif(query_params->>'actorId','')::uuid;
  query := nullif(query_params->>'queryId','')::uuid;
  requested_purpose := nullif(query_params->>'purpose','');
  ceiling := nullif(query_params->>'maxSecurityLevel','');
  policy := nullif(query_params->>'policyVersion','')::bigint;
  if tenant is null or project is null or actor is null or query is null
    or requested_purpose is null or length(requested_purpose)>256 or security.security_rank(ceiling) is null
    or policy is null or policy<1
  then raise exception 'invalid governed query tile scope' using errcode='22023'; end if;

  select s.version_refs,s.spec->'recordQuery',s.spec->'spatialBounds' into refs,record_query,spatial_bounds from service.exploration_snapshot s
  where s.query_id=query and s.tenant_id=tenant and s.project_id=project
    and s.actor_id=actor and s.purpose=requested_purpose and s.security_level=ceiling
    and s.policy_version=policy and s.expires_at>statement_timestamp();
  if refs is null then raise exception 'query unavailable' using errcode='42501'; end if;

  -- Recheck every member, even those outside this tile. No partial authorization.
  select count(*) into authorized_count
  from jsonb_array_elements(refs) ref
  join catalog.data_item_version v on v.version_id=(ref->>'versionId')::uuid
    and v.data_item_id=(ref->>'dataItemId')::uuid
    and v.tenant_id=tenant and v.project_id=project
  join catalog.data_item i on i.data_item_id=v.data_item_id and i.tenant_id=tenant and i.project_id=project
  left join service.analysis_run a on a.analysis_id=(ref->>'analysisId')::uuid
    and a.version_id=v.version_id and a.tenant_id=tenant and a.project_id=project
    and a.completed_at is not null and a.policy_version<=policy
    and security.security_rank(a.security_level)<=security.security_rank(ceiling)
  where v.publication_status='PUBLISHED' and v.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and i.publication_status='PUBLISHED' and i.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and v.policy_version<=policy and i.policy_version<=policy
    and security.security_rank(v.security_level)<=security.security_rank(ceiling)
    and security.security_rank(i.security_level)<=security.security_rank(ceiling)
    and (ref->>'analysisId' is null or a.analysis_id is not null);
  if authorized_count<>jsonb_array_length(refs)
    then raise exception 'query unavailable' using errcode='42501'; end if;

  if spatial_bounds is not null then
    spatial_envelope := public.st_makeenvelope((spatial_bounds->>0)::float8,(spatial_bounds->>1)::float8,(spatial_bounds->>2)::float8,(spatial_bounds->>3)::float8,4326);
  end if;
  bounds := public.st_tileenvelope(z,x,y);
  geographic_bounds := public.st_transform(bounds,4326);
  cell_size := (public.st_xmax(bounds)-public.st_xmin(bounds))/64.0;
  with candidates as materialized (
    select r.record_id::text "recordId",r.asset_id::text "assetId",
      r.analysis_id::text "analysisId",ref->>'versionId' "versionId",ref->>'dataItemId' "dataItemId",
      public.st_transform(public.st_intersection(r.geom,geographic_bounds),3857) geom
    from jsonb_array_elements(refs) ref
    join catalog.analysis_record r on r.analysis_id=(ref->>'analysisId')::uuid
    where not use_amap and r.tenant_id=tenant and r.project_id=project and r.policy_version<=policy
      and security.security_rank(r.security_level)<=security.security_rank(ceiling)
      and (record_query is null or (r.asset_id=(record_query->>'assetId')::uuid and service.exploration_record_matches(r.record_values,record_query->'filters')))
      and (spatial_envelope is null or (r.geom && spatial_envelope and public.st_intersects(r.geom,spatial_envelope)))
      and r.geom && geographic_bounds and public.st_intersects(r.geom,geographic_bounds)
    union all
    select r.record_id::text "recordId",r.asset_id::text "assetId",
      r.analysis_id::text "analysisId",ref->>'versionId' "versionId",ref->>'dataItemId' "dataItemId",
      public.st_intersection(display.geom,bounds) geom
    from jsonb_array_elements(refs) ref
    join service.analysis_amap_geometry display on display.analysis_id=(ref->>'analysisId')::uuid
    -- Always look up immutable records by their primary key, including before
    -- autovacuum has analyzed a newly populated display projection.
    cross join lateral (
      select record.* from catalog.analysis_record record
      where record.analysis_id=display.analysis_id and record.record_id=display.record_id offset 0
    ) r
    where use_amap and display.tenant_id=tenant and display.project_id=project and r.tenant_id=tenant and r.project_id=project and r.policy_version<=policy
      and security.security_rank(r.security_level)<=security.security_rank(ceiling)
      and (record_query is null or (r.asset_id=(record_query->>'assetId')::uuid and service.exploration_record_matches(r.record_values,record_query->'filters')))
      and (spatial_envelope is null or (r.geom && spatial_envelope and public.st_intersects(r.geom,spatial_envelope)))
      and display.geom && bounds and public.st_intersects(display.geom,bounds)
  ), point_cells as (
    select *,least(63,greatest(0,floor((public.st_x(geom)-public.st_xmin(bounds))/cell_size)::int)) gx,
      least(63,greatest(0,floor((public.st_y(geom)-public.st_ymin(bounds))/cell_size)::int)) gy
    from candidates where public.geometrytype(geom)='POINT' and not public.st_isempty(geom)
      and (public.st_x(geom)<public.st_xmax(bounds) or x=(1<<z)-1)
      and (public.st_y(geom)>public.st_ymin(bounds) or y=(1<<z)-1)
  ), grouped as (
    select case when count(*)=1 then min("recordId") end "recordId",
      case when count(*)=1 then min("assetId") end "assetId",
      case when count(*)=1 then min("analysisId") end "analysisId",
      case when count(*)=1 then min("versionId") end "versionId",
      case when count(*)=1 then min("dataItemId") end "dataItemId",
      count(*)::integer count, count(*)>1 cluster,
      'cell:'||z||':'||x||':'||y||':'||gx||':'||gy "clusterId",
      public.st_setsrid(public.st_makepoint(avg(public.st_x(geom)),avg(public.st_y(geom))),3857) geom
    from point_cells group by gx,gy
  ), rows as (
    select * from grouped
    union all
    select "recordId","assetId","analysisId","versionId","dataItemId",1,false,null,geom
    from candidates where public.geometrytype(geom)<>'POINT' and not public.st_isempty(geom)
  ), encoded as (
    select "recordId","assetId","analysisId","versionId","dataItemId",count,cluster,"clusterId",
      public.st_asmvtgeom(geom,bounds,4096,0,true) geom from rows
  )
  select public.st_asmvt(encoded,'exploration',4096,'geom') into tile from encoded where geom is not null;
  if octet_length(tile)>3145728 then raise exception 'tile requires a narrower viewport' using errcode='54000'; end if;
  return coalesce(tile,'\x'::bytea);
end $$;

revoke all on function service.wiser_exploration_mvt_display(integer,integer,integer,json,boolean) from public;
create or replace function service.wiser_exploration_mvt(z integer,x integer,y integer,query_params json)
returns bytea language sql stable security definer parallel restricted set search_path=pg_catalog,public
as $$ select service.wiser_exploration_mvt_display(z,x,y,query_params,false) $$;
create function service.wiser_exploration_amap_mvt(z integer,x integer,y integer,query_params json)
returns bytea language sql stable security definer parallel restricted set search_path=pg_catalog,public
as $$ select service.wiser_exploration_mvt_display(z,x,y,query_params,true) $$;
revoke all on function service.wiser_exploration_amap_mvt(integer,integer,integer,json) from public;
revoke all on function service.wiser_exploration_mvt(integer,integer,integer,json) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_gis') then
    grant execute on function service.wiser_exploration_amap_mvt(integer,integer,integer,json) to wiser_data_gis;
    grant execute on function service.wiser_exploration_mvt(integer,integer,integer,json) to wiser_data_gis;
  end if;
end $$;

-- Martin discovers this function as a single governed vector-tile source.
-- It intentionally owns no identity semantics: the public API resolves a
-- Supabase principal, reauthorizes the requested immutable version through
-- data-postgres RLS, and supplies the five fixed query parameters below.

create or replace function service.wiser_spatial_extent_mvt_display(
  z integer,
  x integer,
  y integer,
  query_params json,
  use_amap boolean
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
        case when use_amap then service.amap_webmercator_geometry(public.st_transform(extent.canonical_geometry,4326)) else coalesce(
          extent.display_geometry,
          public.st_transform(extent.canonical_geometry,3857)
        ) end,
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
      and case when use_amap then service.amap_webmercator_geometry(public.st_transform(extent.canonical_geometry,4326)) else coalesce(
        extent.display_geometry,
        public.st_transform(extent.canonical_geometry,3857)
      ) end && public.st_tileenvelope(z, x, y)
  ) as rows
  where rows.geom is not null;

  return coalesce(tile, '\x'::bytea);
end;
$$;


revoke all on function service.wiser_spatial_extent_mvt_display(integer,integer,integer,json,boolean) from public;
create or replace function service.wiser_spatial_extent_mvt(z integer,x integer,y integer,query_params json)
returns bytea language sql stable security definer parallel restricted set search_path=pg_catalog,public
as $$ select service.wiser_spatial_extent_mvt_display(z,x,y,query_params,false) $$;
create function service.wiser_spatial_extent_amap_mvt(z integer,x integer,y integer,query_params json)
returns bytea language sql stable security definer parallel restricted set search_path=pg_catalog,public
as $$ select service.wiser_spatial_extent_mvt_display(z,x,y,query_params,true) $$;
revoke all on function service.wiser_spatial_extent_amap_mvt(integer,integer,integer,json) from public;
revoke all on function service.wiser_spatial_extent_mvt(integer,integer,integer,json) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_gis') then
    grant execute on function service.wiser_spatial_extent_amap_mvt(integer,integer,integer,json) to wiser_data_gis;
    grant execute on function service.wiser_spatial_extent_mvt(integer,integer,integer,json) to wiser_data_gis;
  end if;
end $$;
analyze service.analysis_amap_geometry;
