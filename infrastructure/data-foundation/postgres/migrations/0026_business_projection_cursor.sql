-- Separate resumable authority sweep; source publication and legacy projection ledgers remain unchanged.
create table service.relation_projection_checkpoint (
 tenant_id uuid not null,project_id uuid not null,target_key text not null,
 last_assertion_id uuid,sweeps bigint not null default 0 check(sweeps>=0),
 security_level text not null check(security.is_valid_security_level(security_level)),
 policy_version bigint not null check(policy_version>0),updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,project_id,target_key)
);
alter table service.relation_projection_checkpoint enable row level security;
alter table service.relation_projection_checkpoint force row level security;
create policy data_scope on service.relation_projection_checkpoint using(security.authorized_row(tenant_id,project_id,security_level,policy_version)) with check(security.authorized_row(tenant_id,project_id,security_level,policy_version));
revoke all on service.relation_projection_checkpoint from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='wiser_data_runtime') then grant select,insert,update on service.relation_projection_checkpoint to wiser_data_runtime; end if;
end $$;
