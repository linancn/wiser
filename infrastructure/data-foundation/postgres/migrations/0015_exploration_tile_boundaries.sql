-- Assign boundary points to exactly one tile. Preserve the immutable 0014 history.
create or replace function service.wiser_exploration_mvt(z integer, x integer, y integer, query_params json)
returns bytea language plpgsql stable security definer parallel restricted
set search_path = pg_catalog, public
as $$
declare
  tenant uuid; project uuid; actor uuid; query uuid;
  requested_purpose text; ceiling text; policy bigint; refs jsonb;
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

  select s.version_refs into refs from service.exploration_snapshot s
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

  bounds := public.st_tileenvelope(z,x,y);
  geographic_bounds := public.st_transform(bounds,4326);
  cell_size := (public.st_xmax(bounds)-public.st_xmin(bounds))/64.0;
  with candidates as materialized (
    select r.record_id::text "recordId",r.asset_id::text "assetId",
      r.analysis_id::text "analysisId",ref->>'versionId' "versionId",ref->>'dataItemId' "dataItemId",
      public.st_transform(public.st_intersection(r.geom,geographic_bounds),3857) geom
    from jsonb_array_elements(refs) ref
    join catalog.analysis_record r on r.analysis_id=(ref->>'analysisId')::uuid
    where r.tenant_id=tenant and r.project_id=project and r.policy_version<=policy
      and security.security_rank(r.security_level)<=security.security_rank(ceiling)
      and r.geom && geographic_bounds and public.st_intersects(r.geom,geographic_bounds)
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
revoke all on function service.wiser_exploration_mvt(integer,integer,integer,json) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_gis') then
    grant execute on function service.wiser_exploration_mvt(integer,integer,integer,json) to wiser_data_gis;
  end if;
end $$;
