-- Derived analysis remains version-bound authority; registration quality is unchanged.
create table service.analysis_run (
  analysis_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  operation_id uuid not null,
  parser_version text not null check (length(parser_version) between 1 and 64),
  status text not null default 'PENDING' check (status in ('PENDING','READY','PARTIAL')),
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status='PENDING') = (completed_at is null)),
  foreign key (tenant_id,project_id,version_id) references catalog.data_item_version (tenant_id,project_id,version_id),
  foreign key (tenant_id,project_id,operation_id) references service.operation (tenant_id,project_id,operation_id),
  unique (tenant_id,project_id,analysis_id),
  unique (tenant_id,project_id,operation_id)
);
create index analysis_version_completed on service.analysis_run (tenant_id,project_id,version_id,completed_at desc) where completed_at is not null;

create table service.analysis_asset (
  analysis_id uuid not null,
  asset_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  source_hash bytea not null check (octet_length(source_hash)=32),
  status text not null check (status in ('READY','EMPTY','PARTIAL','UNSUPPORTED','INVALID','RESTRICTED','MANIFEST')),
  record_count bigint,
  feature_count bigint,
  reason text,
  columns jsonb not null default '[]' check (jsonb_typeof(columns)='array' and jsonb_array_length(columns)<=256),
  source_paths jsonb not null default '[]' check (jsonb_typeof(source_paths)='array' and jsonb_array_length(source_paths)<=1000),
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version>0),
  primary key (analysis_id,asset_id),
  unique (tenant_id,project_id,analysis_id,asset_id),
  foreign key (tenant_id,project_id,analysis_id) references service.analysis_run (tenant_id,project_id,analysis_id),
  foreign key (tenant_id,project_id,asset_id) references catalog.asset (tenant_id,project_id,asset_id),
  check ((status in ('READY','EMPTY','PARTIAL') and record_count>=0 and feature_count>=0 and record_count is not null and feature_count is not null and feature_count<=record_count)
    or (status in ('UNSUPPORTED','INVALID','RESTRICTED','MANIFEST') and record_count is null and feature_count is null and reason is not null)),
  check (status<>'EMPTY' or (record_count=0 and feature_count=0)),
  check (status<>'PARTIAL' or reason is not null)
);

create table catalog.analysis_record (
  analysis_id uuid not null,
  record_id uuid not null,
  asset_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  record_index bigint not null check (record_index>0),
  source_id text,
  record_values jsonb not null check (jsonb_typeof(record_values)='object'),
  geom geometry(Geometry,4326),
  security_level text not null check (security.is_valid_security_level(security_level)),
  policy_version bigint not null check (policy_version>0),
  primary key (analysis_id,record_id),
  unique (analysis_id,asset_id,record_index),
  foreign key (tenant_id,project_id,analysis_id,asset_id) references service.analysis_asset (tenant_id,project_id,analysis_id,asset_id),
  check (geom is null or (st_isvalid(geom) and not st_isempty(geom)))
);
create index analysis_record_geometry on catalog.analysis_record using gist (geom) where geom is not null;
create index analysis_record_scope on catalog.analysis_record (tenant_id,project_id,analysis_id,asset_id,record_index);

create function service.guard_analysis_run() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or (tg_op='UPDATE' and (
    old.completed_at is not null or new.analysis_id<>old.analysis_id or new.tenant_id<>old.tenant_id
    or new.project_id<>old.project_id or new.version_id<>old.version_id or new.operation_id<>old.operation_id
    or new.parser_version<>old.parser_version or new.security_level<>old.security_level
    or new.policy_version<>old.policy_version or new.created_at<>old.created_at
  )) then raise exception 'analysis identity and completed results are immutable' using errcode='55000'; end if;
  if tg_op='INSERT' and not exists (
    select 1 from catalog.data_item_version v join catalog.data_item i using(tenant_id,project_id,data_item_id)
    join service.operation o on o.tenant_id=v.tenant_id and o.project_id=v.project_id and o.operation_id=new.operation_id
    where v.tenant_id=new.tenant_id and v.project_id=new.project_id and v.version_id=new.version_id
      and o.capability_id='data.analysis.create' and o.security_level=new.security_level
      and v.publication_status='PUBLISHED' and i.publication_status='PUBLISHED'
      and security.security_rank(new.security_level)>=security.security_rank(v.security_level)
      and security.security_rank(new.security_level)>=security.security_rank(i.security_level)
      and new.policy_version>=v.policy_version and new.policy_version>=i.policy_version
  ) then raise exception 'analysis source authority mismatch' using errcode='42501'; end if;
  return new;
end $$;
create trigger analysis_run_guard before insert or update or delete on service.analysis_run for each row execute function service.guard_analysis_run();

create function service.guard_analysis_asset() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'analysis evidence is immutable' using errcode='55000'; end if;
  if tg_op='UPDATE' and (new.analysis_id<>old.analysis_id or new.asset_id<>old.asset_id
    or new.tenant_id<>old.tenant_id or new.project_id<>old.project_id or new.source_hash<>old.source_hash
    or new.source_paths<>old.source_paths or new.security_level<>old.security_level or new.policy_version<>old.policy_version)
  then raise exception 'analysis evidence identity is immutable' using errcode='55000'; end if;
  if not exists (
    select 1 from service.analysis_run r join catalog.asset a on a.tenant_id=r.tenant_id and a.project_id=r.project_id and a.version_id=r.version_id
    where r.analysis_id=new.analysis_id and r.tenant_id=new.tenant_id and r.project_id=new.project_id
      and r.status='PENDING' and a.asset_id=new.asset_id and a.content_hash=new.source_hash
      and new.security_level=r.security_level and new.policy_version=r.policy_version
      and security.security_rank(new.security_level)>=security.security_rank(a.security_level)
      and new.policy_version>=a.policy_version
  ) then raise exception 'analysis source is unavailable or already finalized' using errcode='55000'; end if;
  return new;
end $$;
create trigger analysis_asset_guard before insert or update or delete on service.analysis_asset for each row execute function service.guard_analysis_asset();
create trigger analysis_record_immutable before update or delete on catalog.analysis_record for each row execute function event.reject_append_only_mutation();
create function service.guard_analysis_record() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if not exists (
    select 1 from service.analysis_asset a join service.analysis_run r using(tenant_id,project_id,analysis_id)
    where a.analysis_id=new.analysis_id and a.asset_id=new.asset_id and a.tenant_id=new.tenant_id and a.project_id=new.project_id
      and a.security_level=new.security_level and a.policy_version=new.policy_version and r.status='PENDING'
  ) then raise exception 'analysis record authority mismatch' using errcode='42501'; end if;
  return new;
end $$;
create trigger analysis_record_guard before insert on catalog.analysis_record for each row execute function service.guard_analysis_record();

do $$ declare target text; begin
  foreach target in array array['service.analysis_run','service.analysis_asset','catalog.analysis_record'] loop
    execute format('alter table %s enable row level security',target);
    execute format('alter table %s force row level security',target);
    execute format('create policy analysis_scope on %s using (security.authorized_row(tenant_id,project_id,security_level,policy_version))',target);
    execute format('revoke all on %s from public',target);
    if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
      execute format('grant select,insert,update,delete on %s to wiser_data_runtime',target);
    end if;
  end loop;
end $$;
