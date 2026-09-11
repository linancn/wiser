-- Add governed source bindings to the existing knowledge authority. Historical rows remain unchanged.
alter table knowledge.assertion alter column confidence drop not null;
create table knowledge.assertion_binding (
  assertion_id uuid primary key,
  tenant_id uuid not null, project_id uuid not null,
  data_item_id uuid not null, version_id uuid not null,
  mapping_version text not null check(length(mapping_version) between 1 and 128),
  identity_key text not null check(length(identity_key) between 1 and 2048),
  fingerprint bytea not null check(octet_length(fingerprint)=32),
  candidate jsonb not null check(jsonb_typeof(candidate)='object' and octet_length(candidate::text)<=131072),
  security_level text not null check(security.is_valid_security_level(security_level)),
  policy_version bigint not null check(policy_version>0),
  foreign key(tenant_id,project_id,assertion_id) references knowledge.assertion(tenant_id,project_id,assertion_id),
  foreign key(tenant_id,project_id,data_item_id) references catalog.data_item(tenant_id,project_id,data_item_id),
  foreign key(tenant_id,project_id,version_id) references catalog.data_item_version(tenant_id,project_id,version_id),
  unique(tenant_id,project_id,version_id,mapping_version,identity_key)
);
create index assertion_binding_version on knowledge.assertion_binding(tenant_id,project_id,version_id,assertion_id);
alter table knowledge.assertion_binding enable row level security;
alter table knowledge.assertion_binding force row level security;
create policy data_scope on knowledge.assertion_binding using(security.authorized_row(tenant_id,project_id,security_level,policy_version)) with check(security.authorized_row(tenant_id,project_id,security_level,policy_version));
create trigger assertion_binding_immutable before update or delete on knowledge.assertion_binding for each row execute function event.reject_append_only_mutation();
create function knowledge.guard_relation_binding() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if not exists(select 1 from knowledge.assertion a join knowledge.evidence_fragment e using(tenant_id,project_id,evidence_fragment_id)
    where a.assertion_id=new.assertion_id and a.tenant_id=new.tenant_id and a.project_id=new.project_id
      and e.version_id=new.version_id and e.data_item_id=new.data_item_id
      and a.subject=new.candidate->'subject' and a.predicate=new.candidate->>'predicate' and a.object=new.candidate->'object'
      and a.confidence is null and a.status='PENDING_REVIEW') then
    raise exception 'Relation binding must match its pending source assertion' using errcode='23514';
  end if;
  if jsonb_array_length(new.candidate->'evidence') not between 1 and 64 or exists(
    select 1 from jsonb_array_elements(new.candidate->'evidence') e where not exists(
      select 1 from catalog.asset a where a.tenant_id=new.tenant_id and a.project_id=new.project_id and a.version_id=new.version_id
        and a.asset_id=(e->>'assetId')::uuid and a.content_hash=decode(e->>'sourceHash','hex') and a.lifecycle_state='RAW'
        and security.security_rank(a.security_level)<=security.security_rank(new.security_level))) then
    raise exception 'Relation evidence must bind saved source files' using errcode='23514';
  end if;
  return new;
end $$;
create trigger relation_binding_source before insert on knowledge.assertion_binding for each row execute function knowledge.guard_relation_binding();
create function knowledge.guard_relation_authority() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_table_name='assertion' then
   if exists(select 1 from knowledge.assertion_binding where assertion_id=old.assertion_id) then
    if tg_op='DELETE' then raise exception 'Relation assertions are retained' using errcode='23514'; end if;
    if (to_jsonb(new)-array['status','row_version','updated_at']) is distinct from (to_jsonb(old)-array['status','row_version','updated_at'])
       or new.row_version<>old.row_version+1 or not exists(select 1 from knowledge.review_record r where r.assertion_id=old.assertion_id and r.row_version=new.row_version and r.decision=new.status and r.created_at=new.updated_at) then
      raise exception 'Relation changes require a matching versioned review' using errcode='23514';
    end if;
   end if;
  elsif tg_table_name='review_record' then
   if exists(select 1 from knowledge.assertion_binding where assertion_id=old.assertion_id) then
    raise exception 'Relation review history is immutable' using errcode='23514';
   end if;
  elsif tg_table_name='evidence_fragment' then
   if exists(select 1 from knowledge.assertion a join knowledge.assertion_binding b using(assertion_id) where a.evidence_fragment_id=old.evidence_fragment_id) then
    raise exception 'Relation source evidence is immutable' using errcode='23514';
   end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger relation_assertion_guard before update or delete on knowledge.assertion for each row execute function knowledge.guard_relation_authority();
create trigger relation_review_guard before update or delete on knowledge.review_record for each row execute function knowledge.guard_relation_authority();
create trigger relation_evidence_guard before update or delete on knowledge.evidence_fragment for each row execute function knowledge.guard_relation_authority();
revoke all on knowledge.assertion_binding from public;
revoke all on function knowledge.guard_relation_binding(),knowledge.guard_relation_authority() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
    grant select,insert on knowledge.assertion_binding to wiser_data_runtime;
  end if;
end $$;
