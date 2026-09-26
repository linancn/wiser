-- Bounded business approval records in the existing identity control plane.
-- No project is enabled, approver designated, or resource grant issued here.
create table platform_private.resource_approval_roles (
 project_id uuid not null references platform_private.resource_access_settings(project_id) on delete restrict,
 role_id uuid not null references platform.roles(id) on delete restrict,
 active boolean not null default true,
 configured_by uuid not null references platform.actors(id) on delete restrict,
 reason text not null check(length(reason) between 5 and 1000),
 created_at timestamptz not null default now(),
 primary key(project_id,role_id)
);
create table platform_private.resource_batches (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references platform_private.resource_access_settings(project_id) on delete restrict,
 package_id uuid not null, package_version integer not null,
 preset_id uuid not null, preset_version integer not null,
 applicant_id uuid not null references platform.actors(id) on delete restrict,
 purpose text not null check(purpose in ('web-console','agent-data')),
 starts_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>starts_at),
 valid_until timestamptz not null check(valid_until<=expires_at),
 reason text not null check(length(reason) between 5 and 1000),
 status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn','partial','executed')),
 version integer not null default 1 check(version between 1 and 2147483646),
 decided_by uuid references platform.actors(id) on delete restrict,
 decided_session_id uuid,
 decision_reason text check(length(decision_reason) between 5 and 1000),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(project_id,package_id,package_version) references platform_private.resource_package_versions(project_id,package_id,version) on delete restrict,
 foreign key(project_id,preset_id,preset_version) references platform_private.resource_preset_versions(project_id,preset_id,version) on delete restrict,
 check(decided_by is null or decided_by<>applicant_id),
 check((status in ('pending','withdrawn') and decided_by is null and decided_session_id is null and decision_reason is null and decided_at is null)
 or(status in ('approved','rejected','partial','executed') and decided_by is not null and decided_session_id is not null and decision_reason is not null and decided_at is not null)),
 unique(id,project_id)
);
create index resource_batches_project_idx on platform_private.resource_batches(project_id,created_at desc,id);
create table platform_private.resource_batch_members (
 batch_id uuid not null,
 project_id uuid not null,
 actor_id uuid not null references platform.actors(id) on delete restrict,
 ordinal integer not null check(ordinal between 1 and 50),
 membership_version bigint not null check(membership_version>0),
 display_name text not null check(length(display_name) between 1 and 320),
 existing_grant_count integer not null check(existing_grant_count>=0),
 primary key(batch_id,actor_id),
 unique(batch_id,ordinal),
 unique(batch_id,project_id,actor_id),
 foreign key(batch_id,project_id) references platform_private.resource_batches(id,project_id) on delete restrict
);
create table platform_private.resource_batch_attempts (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null,
 project_id uuid not null,
 actor_id uuid not null,
 attempt integer not null check(attempt between 1 and 1000),
 executed_by uuid not null references platform.actors(id) on delete restrict,
 grant_id uuid,
 error_code text check(error_code in ('MEMBERSHIP_CHANGED','RESOURCE_UNAVAILABLE','AUTHORITY_CHANGED','EXECUTION_FAILED')),
 created_at timestamptz not null default now(),
 foreign key(batch_id,project_id,actor_id) references platform_private.resource_batch_members(batch_id,project_id,actor_id) on delete restrict,
 foreign key(grant_id,project_id) references platform_private.resource_grants(id,project_id) on delete restrict,
 check((grant_id is not null and error_code is null) or(grant_id is null and error_code is not null)),
 unique(batch_id,actor_id,attempt)
);
create unique index resource_batch_success_once on platform_private.resource_batch_attempts(batch_id,actor_id) where grant_id is not null;

create function platform_private.guard_resource_batch() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='22023',message='Batch history cannot be deleted.'; end if;
 if (to_jsonb(new)-array['status','version','decided_by','decided_session_id','decision_reason','decided_at','updated_at'])
 is distinct from (to_jsonb(old)-array['status','version','decided_by','decided_session_id','decision_reason','decided_at','updated_at'])
 or new.version<>old.version+1 then raise exception using errcode='22023',message='Batch snapshot is immutable.'; end if;
 if not ((old.status='pending' and new.status in ('approved','rejected','withdrawn'))
 or(old.status in ('approved','partial') and new.status in ('partial','executed'))) then
 raise exception using errcode='22023',message='Invalid batch state transition.'; end if;
 if old.status<>'pending' and (new.decided_by,new.decided_session_id,new.decision_reason,new.decided_at)
 is distinct from (old.decided_by,old.decided_session_id,old.decision_reason,old.decided_at) then
 raise exception using errcode='22023',message='Approval history is immutable.'; end if;
 if new.decided_by is not null and exists(select 1 from platform_private.resource_batch_members where batch_id=new.id and actor_id=new.decided_by) then
 raise exception using errcode='23514',message='Recipient cannot approve own batch.'; end if;
 return new;
end $$;
create trigger resource_batch_guard before update or delete on platform_private.resource_batches for each row execute function platform_private.guard_resource_batch();

create function platform_private.guard_resource_batch_member() returns trigger language plpgsql set search_path='' as $$
declare state text;
begin
 select status into state from platform_private.resource_batches where id=new.batch_id and project_id=new.project_id for update;
 if state<>'pending' then raise exception using errcode='23514',message='Approved recipient list cannot expand.'; end if;
 return new;
end $$;
create trigger resource_batch_member_guard before insert on platform_private.resource_batch_members for each row execute function platform_private.guard_resource_batch_member();
create function platform_private.guard_resource_batch_attempt() returns trigger language plpgsql set search_path='' as $$
declare batch platform_private.resource_batches; granted platform_private.resource_grants;
begin
 select * into batch from platform_private.resource_batches where id=new.batch_id and project_id=new.project_id for update;
 if batch.status not in ('approved','partial') then raise exception using errcode='23514',message='Batch is not approved for execution.'; end if;
 if exists(select 1 from platform_private.resource_batch_attempts where batch_id=new.batch_id and actor_id=new.actor_id and grant_id is not null) then
 raise exception using errcode='23514',message='Successful recipient cannot be executed twice.'; end if;
 if new.grant_id is not null then
 select * into granted from platform_private.resource_grants where id=new.grant_id and project_id=new.project_id;
 if granted.id is null or granted.actor_id<>new.actor_id or granted.approved_by<>batch.decided_by
 or (granted.package_id,granted.package_version,granted.preset_id,granted.preset_version,granted.purpose,granted.starts_at,granted.expires_at)
 is distinct from (batch.package_id,batch.package_version,batch.preset_id,batch.preset_version,batch.purpose,batch.starts_at,batch.expires_at) then
 raise exception using errcode='23514',message='Grant must match the approved snapshot.'; end if;
 end if;
 return new;
end $$;
create trigger resource_batch_attempt_guard before insert on platform_private.resource_batch_attempts for each row execute function platform_private.guard_resource_batch_attempt();
revoke all on function platform_private.guard_resource_batch(),platform_private.guard_resource_batch_member(),platform_private.guard_resource_batch_attempt() from public,anon,authenticated,service_role;

do $$ declare relation_name text; begin
 foreach relation_name in array array['resource_approval_roles','resource_batches','resource_batch_members','resource_batch_attempts'] loop
 execute format('alter table platform_private.%I enable row level security',relation_name);
 execute format('alter table platform_private.%I force row level security',relation_name);
 execute format('revoke all on platform_private.%I from public,anon,authenticated,service_role',relation_name);
 if relation_name in ('resource_batch_members','resource_batch_attempts') then
 execute format('create trigger %I before update or delete on platform_private.%I for each row execute function platform_private.reject_project_access_history_change()',relation_name||'_immutable',relation_name);
 end if;
 end loop;
end $$;
-- Cover all control-plane foreign-key lookups without changing authorization.
create index resource_approval_roles_role_idx on platform_private.resource_approval_roles(role_id);
create index resource_approval_roles_configurator_idx on platform_private.resource_approval_roles(configured_by);
create index resource_batches_package_idx on platform_private.resource_batches(project_id,package_id,package_version);
create index resource_batches_preset_idx on platform_private.resource_batches(project_id,preset_id,preset_version);
create index resource_batches_applicant_idx on platform_private.resource_batches(applicant_id);
create index resource_batches_approver_idx on platform_private.resource_batches(decided_by);
create index resource_batch_members_actor_idx on platform_private.resource_batch_members(actor_id);
create index resource_batch_attempts_member_idx on platform_private.resource_batch_attempts(batch_id,project_id,actor_id);
create index resource_batch_attempts_grant_idx on platform_private.resource_batch_attempts(grant_id,project_id);
create index resource_batch_attempts_executor_idx on platform_private.resource_batch_attempts(executed_by);
-- Null historical snapshots are rejected at execution; never infer old authority from current membership.
alter table platform_private.resource_batch_members add column tenant_membership_version bigint check(tenant_membership_version>0);
alter table platform_private.resource_batch_members add column actor_authz_version bigint check(actor_authz_version>0);
-- Preserve historical previews as unknown; require a fresh snapshot for approval/execution.
alter table platform_private.resource_batch_members
 add column grant_snapshot_hash text check(grant_snapshot_hash~'^[0-9a-f]{64}$'),
 add column grant_diff jsonb check(jsonb_typeof(grant_diff)='object' and octet_length(grant_diff::text)<=8192);
alter table platform_private.resource_batch_attempts drop constraint resource_batch_attempts_error_code_check;
alter table platform_private.resource_batch_attempts add constraint resource_batch_attempts_error_code_check
 check(error_code in ('MEMBERSHIP_CHANGED','RESOURCE_UNAVAILABLE','AUTHORITY_CHANGED','EXECUTION_FAILED','ACCESS_CHANGED'));
