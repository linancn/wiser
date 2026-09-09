-- Immutable, owner-scoped reconciliation evidence. Originals are never modified.
create table service.observation_reconciliation (
  batch_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  actor_id uuid not null,
  purpose text not null check(length(purpose) between 1 and 256),
  security_level text not null check(security.is_valid_security_level(security_level)),
  policy_version bigint not null check(policy_version>0),
  status text not null default 'CANDIDATE' check(status in ('CANDIDATE','VERIFIED','REJECTED')),
  row_version integer not null default 1 check(row_version in (1,2)),
  input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=65536),
  sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)=2 and octet_length(sources::text)<=1048576),
  summary jsonb not null check(jsonb_typeof(summary)='object' and octet_length(summary::text)<=4096),
  groups jsonb not null check(jsonb_typeof(groups)='array' and jsonb_array_length(groups)<=50000 and octet_length(groups::text)<=33554432),
  created_at timestamptz not null,
  reviewed_at timestamptz,
  review_note text check(length(btrim(review_note)) between 1 and 2000),
  check((status='CANDIDATE' and row_version=1 and reviewed_at is null and review_note is null)
    or (status<>'CANDIDATE' and row_version=2 and reviewed_at>=created_at and review_note is not null)),
  check(status<>'VERIFIED' or (summary->>'candidateObservationCount' is not null
    and (summary->>'conflictCount')::integer=0 and (summary->>'incompleteRecordCount')::integer=0))
);
create index observation_reconciliation_owner on service.observation_reconciliation(tenant_id,project_id,actor_id,created_at desc,batch_id);
alter table service.observation_reconciliation enable row level security;
alter table service.observation_reconciliation force row level security;
create policy observation_reconciliation_owner on service.observation_reconciliation using (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid
  and purpose=nullif(current_setting('wiser.purpose',true),'')
) with check (
  security.authorized_row(tenant_id,project_id,security_level,policy_version)
  and actor_id=nullif(current_setting('wiser.actor_id',true),'')::uuid
  and purpose=nullif(current_setting('wiser.purpose',true),'')
);
create function service.guard_observation_reconciliation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    if new.status<>'CANDIDATE' then raise exception 'Reconciliation requires review' using errcode='23514'; end if;
  elsif tg_op='DELETE' then
    raise exception 'Reconciliation evidence is immutable' using errcode='23514';
  elsif old.status<>'CANDIDATE' or new.status='CANDIDATE' or new.row_version<>old.row_version+1
    or (to_jsonb(new)-array['status','row_version','reviewed_at','review_note']) is distinct from
       (to_jsonb(old)-array['status','row_version','reviewed_at','review_note']) then
    raise exception 'Reconciliation evidence is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger observation_reconciliation_guard before insert or update or delete on service.observation_reconciliation for each row execute function service.guard_observation_reconciliation();
revoke all on service.observation_reconciliation from public;
revoke all on function service.guard_observation_reconciliation() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then
    grant select,insert on service.observation_reconciliation to wiser_data_runtime;
    grant update(status,row_version,reviewed_at,review_note) on service.observation_reconciliation to wiser_data_runtime;
  end if;
end $$;
