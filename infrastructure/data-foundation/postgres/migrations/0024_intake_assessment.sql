-- Append-only checks and availability observations; existing publication is unchanged.
create table service.intake_assessment (
  assessment_id uuid primary key,
  tenant_id uuid not null, project_id uuid not null, actor_id uuid not null,
  purpose text not null check(length(purpose) between 1 and 256),
  data_item_id uuid not null, version_id uuid not null, asset_id uuid not null,
  analysis_id uuid,
  source_hash bytea not null check(octet_length(source_hash)=32),
  security_level text not null check(security.is_valid_security_level(security_level)),
  policy_version bigint not null check(policy_version>0),
  declaration jsonb not null check(jsonb_typeof(declaration)='object' and octet_length(declaration::text)<=131072),
  facts jsonb not null check(jsonb_typeof(facts)='object' and octet_length(facts::text)<=131072),
  result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=65536),
  created_at timestamptz not null,
  foreign key (tenant_id,project_id,data_item_id) references catalog.data_item(tenant_id,project_id,data_item_id),
  foreign key (tenant_id,project_id,version_id) references catalog.data_item_version(tenant_id,project_id,version_id),
  foreign key (tenant_id,project_id,asset_id) references catalog.asset(tenant_id,project_id,asset_id),
  foreign key (tenant_id,project_id,analysis_id) references service.analysis_run(tenant_id,project_id,analysis_id),
  check(result->>'sourceHash'=encode(source_hash,'hex') and facts->>'sourceHash'=encode(source_hash,'hex'))
);
create index intake_assessment_version on service.intake_assessment(tenant_id,project_id,version_id,assessment_id);
alter table service.intake_assessment enable row level security;
alter table service.intake_assessment force row level security;
create policy intake_assessment_scope on service.intake_assessment using (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
) with check (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
);
create function service.guard_intake_assessment() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op<>'INSERT' then raise exception 'Assessment evidence is immutable' using errcode='23514'; end if;
  if not exists(select 1 from catalog.asset a join catalog.data_item_version v using(tenant_id,project_id,version_id)
    where a.tenant_id=new.tenant_id and a.project_id=new.project_id and a.asset_id=new.asset_id
      and a.version_id=new.version_id and v.data_item_id=new.data_item_id and a.content_hash=new.source_hash
      and a.lifecycle_state='RAW' and security.security_rank(new.security_level)>=security.security_rank(a.security_level)
      and (new.analysis_id is null or exists(select 1 from service.analysis_asset aa join service.analysis_run ar using(tenant_id,project_id,analysis_id)
        where aa.analysis_id=new.analysis_id and aa.asset_id=new.asset_id and aa.source_hash=new.source_hash and ar.version_id=new.version_id and ar.completed_at is not null))) then
    raise exception 'Assessment must bind saved source facts' using errcode='23514';
  end if;
  return new;
end $$;
create trigger intake_assessment_guard before insert or update or delete on service.intake_assessment for each row execute function service.guard_intake_assessment();
revoke all on service.intake_assessment from public;
revoke all on function service.guard_intake_assessment() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
    grant select,insert on service.intake_assessment to wiser_data_runtime;
  end if;
end $$;
