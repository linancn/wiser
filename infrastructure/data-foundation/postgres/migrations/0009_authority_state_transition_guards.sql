alter table service.operation
  drop constraint if exists operation_authority_versions_positive,
  add constraint operation_authority_versions_positive
    check (policy_version > 0 and row_version > 0);

alter table ingestion.session
  drop constraint if exists ingestion_session_authority_versions_positive,
  add constraint ingestion_session_authority_versions_positive
    check (expected_version > 0 and policy_version > 0 and row_version > 0);

alter table ingestion.job
  drop constraint if exists ingestion_job_authority_versions_positive,
  add constraint ingestion_job_authority_versions_positive
    check (policy_version > 0 and row_version > 0);

create or replace function service.guard_operation_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.operation_id is distinct from old.operation_id
    or new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.capability_id is distinct from old.capability_id
    or new.actor_id is distinct from old.actor_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.policy_version is distinct from old.policy_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'operation authority identity is immutable'
      using errcode = '42501';
  end if;
  if new.security_level is distinct from old.security_level
    and (
      old.capability_id <> 'data.uploadSession.create'
      or old.status <> 'WAITING_INPUT'
      or new.status <> 'SUCCEEDED'
      or security.security_rank(new.security_level)
        < security.security_rank(old.security_level)
    )
  then
    raise exception 'operation security level cannot be changed here'
      using errcode = '42501';
  end if;
  if new.request_payload is distinct from old.request_payload
    and (
      old.capability_id <> 'data.uploadSession.create'
      or old.status <> 'WAITING_INPUT'
      or new.status <> 'SUCCEEDED'
      or not (new.request_payload ? 'completionClaims')
      or (new.request_payload - 'completionClaims')
        is distinct from (old.request_payload - 'completionClaims')
    )
  then
    raise exception 'operation request payload may add only completion claims'
      using errcode = '55000';
  end if;

  if new.status is not distinct from old.status then
    if old.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
      raise exception 'terminal operation content is immutable'
        using errcode = '55000';
    end if;
    if old.status not in ('RUNNING', 'WAITING_INPUT', 'WAITING_REVIEW')
      or new.progress_percent < old.progress_percent
      or new.result_payload is distinct from old.result_payload
      or new.error_code is not null
      or new.error_message is not null
      or new.error_retryable is not null
      or not (
        new.started_at is not distinct from old.started_at
        or (old.started_at is null and new.started_at is not null)
      )
      or new.completed_at is not null
    then
      raise exception 'invalid same-state operation mutation'
        using errcode = '55000';
    end if;
  elsif (old.status, new.status) in (
    ('PENDING', 'RUNNING'),
    ('PENDING', 'WAITING_INPUT'),
    ('PENDING', 'WAITING_REVIEW'),
    ('PENDING', 'FAILED'),
    ('PENDING', 'CANCELLED'),
    ('RUNNING', 'WAITING_INPUT'),
    ('RUNNING', 'WAITING_REVIEW'),
    ('RUNNING', 'SUCCEEDED'),
    ('RUNNING', 'FAILED'),
    ('RUNNING', 'CANCELLED'),
    ('WAITING_INPUT', 'RUNNING'),
    ('WAITING_INPUT', 'WAITING_REVIEW'),
    ('WAITING_INPUT', 'FAILED'),
    ('WAITING_INPUT', 'CANCELLED'),
    ('WAITING_REVIEW', 'RUNNING'),
    ('WAITING_REVIEW', 'WAITING_INPUT'),
    ('WAITING_REVIEW', 'SUCCEEDED'),
    ('WAITING_REVIEW', 'FAILED'),
    ('WAITING_REVIEW', 'CANCELLED')
  ) or (
    old.capability_id = 'data.uploadSession.create'
    and old.status = 'WAITING_INPUT'
    and new.status = 'SUCCEEDED'
  ) then
    null;
  else
    raise exception 'invalid operation status transition % -> %', old.status, new.status
      using errcode = '55000';
  end if;

  if new.row_version is distinct from old.row_version + 1 then
    raise exception 'operation row version must advance exactly once'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists operation_status_transition_guard on service.operation;
create trigger operation_status_transition_guard
before update on service.operation
for each row execute function service.guard_operation_status_transition();

create or replace function ingestion.guard_session_state_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.ingestion_id is distinct from old.ingestion_id
    or new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.operation_id is distinct from old.operation_id
    or new.owner_project_id is distinct from old.owner_project_id
    or new.intended_uses is distinct from old.intended_uses
    or new.expected_version is distinct from old.expected_version
    or new.requested_security_level is distinct from old.requested_security_level
    or new.security_level is distinct from old.security_level
    or new.policy_version is distinct from old.policy_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'ingestion session authority identity is immutable'
      using errcode = '42501';
  end if;
  if (
    new.approved_by_actor_id is distinct from old.approved_by_actor_id
    or new.approved_at is distinct from old.approved_at
  ) and new.state <> 'APPROVED'
  then
    raise exception 'ingestion approval facts may change only on approval'
      using errcode = '55000';
  end if;
  if (old.state, new.state) in (
    ('RECEIVED', 'QUARANTINED'),
    ('RECEIVED', 'FAILED'),
    ('RECEIVED', 'CANCELLED'),
    ('QUARANTINED', 'SECURITY_SCANNED'),
    ('QUARANTINED', 'FAILED'),
    ('QUARANTINED', 'CANCELLED'),
    ('SECURITY_SCANNED', 'FINGERPRINTED'),
    ('SECURITY_SCANNED', 'REJECTED'),
    ('SECURITY_SCANNED', 'FAILED'),
    ('SECURITY_SCANNED', 'CANCELLED'),
    ('FINGERPRINTED', 'PROFILED'),
    ('FINGERPRINTED', 'FAILED'),
    ('FINGERPRINTED', 'CANCELLED'),
    ('PROFILED', 'CLASSIFIED'),
    ('PROFILED', 'FAILED'),
    ('PROFILED', 'CANCELLED'),
    ('CLASSIFIED', 'SCHEMA_MAPPED'),
    ('CLASSIFIED', 'FAILED'),
    ('CLASSIFIED', 'CANCELLED'),
    ('SCHEMA_MAPPED', 'SEMANTIC_MAPPED'),
    ('SCHEMA_MAPPED', 'FAILED'),
    ('SCHEMA_MAPPED', 'CANCELLED'),
    ('SEMANTIC_MAPPED', 'VALIDATED'),
    ('SEMANTIC_MAPPED', 'FAILED'),
    ('SEMANTIC_MAPPED', 'CANCELLED'),
    ('VALIDATED', 'SPATIOTEMPORAL_ALIGNED'),
    ('VALIDATED', 'REJECTED'),
    ('VALIDATED', 'FAILED'),
    ('VALIDATED', 'CANCELLED'),
    ('SPATIOTEMPORAL_ALIGNED', 'REVIEW_REQUIRED'),
    ('SPATIOTEMPORAL_ALIGNED', 'APPROVED'),
    ('SPATIOTEMPORAL_ALIGNED', 'FAILED'),
    ('SPATIOTEMPORAL_ALIGNED', 'CANCELLED'),
    ('REVIEW_REQUIRED', 'APPROVED'),
    ('REVIEW_REQUIRED', 'REJECTED'),
    ('REVIEW_REQUIRED', 'FAILED'),
    ('REVIEW_REQUIRED', 'CANCELLED'),
    ('APPROVED', 'COMMITTED'),
    ('APPROVED', 'FAILED'),
    ('APPROVED', 'CANCELLED'),
    ('COMMITTED', 'PROJECTING'),
    ('COMMITTED', 'FAILED'),
    ('PROJECTING', 'PUBLISHED'),
    ('PROJECTING', 'FAILED')
  ) then
    null;
  else
    raise exception 'invalid ingestion state transition % -> %', old.state, new.state
      using errcode = '55000';
  end if;

  if new.row_version is distinct from old.row_version + 1 then
    raise exception 'ingestion session row version must advance exactly once'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists ingestion_session_state_transition_guard on ingestion.session;
create trigger ingestion_session_state_transition_guard
before update on ingestion.session
for each row execute function ingestion.guard_session_state_transition();

create or replace function ingestion.guard_job_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.job_id is distinct from old.job_id
    or new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.ingestion_id is distinct from old.ingestion_id
    or new.operation_id is distinct from old.operation_id
    or new.job_type is distinct from old.job_type
    or new.idempotency_key is distinct from old.idempotency_key
    or new.priority is distinct from old.priority
    or new.depends_on_job_id is distinct from old.depends_on_job_id
    or new.max_attempts is distinct from old.max_attempts
    or new.backoff_base_seconds is distinct from old.backoff_base_seconds
    or new.backoff_max_seconds is distinct from old.backoff_max_seconds
    or new.security_level is distinct from old.security_level
    or new.policy_version is distinct from old.policy_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'ingestion job authority identity is immutable'
      using errcode = '42501';
  end if;
  if new.payload is distinct from old.payload
    and not (
      old.status in ('WAITING_INPUT', 'WAITING_REVIEW')
      and new.status = 'PENDING'
    )
  then
    raise exception 'ingestion job payload may change only when waking input'
      using errcode = '55000';
  end if;
  if new.timeout_at is distinct from old.timeout_at
    and not (
      old.status in ('WAITING_INPUT', 'WAITING_REVIEW')
      and new.status = 'PENDING'
    )
  then
    raise exception 'ingestion job timeout may change only when waking input'
      using errcode = '55000';
  end if;
  if (
    new.status = 'RUNNING'
    and old.status in ('PENDING', 'RETRY_SCHEDULED')
    and new.attempt_count is distinct from old.attempt_count + 1
  ) or (
    not (
      new.status = 'RUNNING'
      and old.status in ('PENDING', 'RETRY_SCHEDULED')
    )
    and new.attempt_count is distinct from old.attempt_count
  ) then
    raise exception 'ingestion job attempt count does not match its transition'
      using errcode = '55000';
  end if;
  if new.status is not distinct from old.status and old.status = 'RUNNING' then
    if new.lease_owner is null
      or new.lease_owner is distinct from old.lease_owner
      or new.next_attempt_at is distinct from old.next_attempt_at
      or new.error_category is distinct from old.error_category
      or new.last_error_detail is distinct from old.last_error_detail
      or new.completed_at is not null
      or not (
        (
          new.cancel_requested_at is not distinct from old.cancel_requested_at
          and (
            new.heartbeat_at is distinct from old.heartbeat_at
            or new.lease_expires_at is distinct from old.lease_expires_at
          )
          and new.heartbeat_at is not null
          and new.lease_expires_at is not null
          and (
            old.heartbeat_at is null
            or new.heartbeat_at >= old.heartbeat_at
          )
        )
        or (
          new.lease_expires_at is not distinct from old.lease_expires_at
          and new.heartbeat_at is not distinct from old.heartbeat_at
          and new.cancel_requested_at is not null
          and (
            (
              old.cancel_requested_at is null
              and new.cancel_requested_at is distinct from old.cancel_requested_at
            )
            or (
              old.cancel_requested_at is not null
              and new.cancel_requested_at is not distinct from old.cancel_requested_at
            )
          )
        )
      )
    then
      raise exception 'invalid running job heartbeat or cancellation mutation'
        using errcode = '55000';
    end if;
  elsif (old.status, new.status) in (
    ('PENDING', 'RUNNING'),
    ('PENDING', 'CANCELLED'),
    ('PENDING', 'DEAD_LETTER'),
    ('RUNNING', 'WAITING_INPUT'),
    ('RUNNING', 'WAITING_REVIEW'),
    ('RUNNING', 'RETRY_SCHEDULED'),
    ('RUNNING', 'SUCCEEDED'),
    ('RUNNING', 'FAILED'),
    ('RUNNING', 'CANCELLED'),
    ('RUNNING', 'DEAD_LETTER'),
    ('WAITING_INPUT', 'PENDING'),
    ('WAITING_INPUT', 'CANCELLED'),
    ('WAITING_INPUT', 'DEAD_LETTER'),
    ('WAITING_REVIEW', 'PENDING'),
    ('WAITING_REVIEW', 'CANCELLED'),
    ('WAITING_REVIEW', 'DEAD_LETTER'),
    ('RETRY_SCHEDULED', 'RUNNING'),
    ('RETRY_SCHEDULED', 'CANCELLED'),
    ('RETRY_SCHEDULED', 'DEAD_LETTER')
  ) then
    null;
  else
    raise exception 'invalid job status transition % -> %', old.status, new.status
      using errcode = '55000';
  end if;

  if new.row_version is distinct from old.row_version + 1 then
    raise exception 'ingestion job row version must advance exactly once'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists ingestion_job_status_transition_guard on ingestion.job;
create trigger ingestion_job_status_transition_guard
before update on ingestion.job
for each row execute function ingestion.guard_job_status_transition();

alter table ingestion.transform_plan
  drop constraint if exists transform_plan_status_check,
  add constraint transform_plan_status_check
    check (status in ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED')),
  drop constraint if exists transform_plan_authority_versions_positive,
  add constraint transform_plan_authority_versions_positive
    check (plan_version > 0 and policy_version > 0 and row_version > 0);

create or replace function ingestion.guard_transform_plan_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.transform_plan_id is distinct from old.transform_plan_id
    or new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.ingestion_id is distinct from old.ingestion_id
    or new.security_level is distinct from old.security_level
    or new.policy_version is distinct from old.policy_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'transform plan authority identity is immutable'
      using errcode = '42501';
  end if;
  if new.plan_version is distinct from old.plan_version
    or new.plan is distinct from old.plan
    or new.plan_hash is distinct from old.plan_hash
  then
    raise exception 'transform plan authority content is immutable'
      using errcode = '55000';
  end if;
  if new.approved_by_actor_id is distinct from old.approved_by_actor_id
    and not (old.status = 'REVIEW_REQUIRED' and new.status = 'APPROVED')
  then
    raise exception 'transform plan approval actor may change only on approval'
      using errcode = '55000';
  end if;
  if new.status is not distinct from old.status then
    null;
  elsif (old.status, new.status) in (
    ('DRAFT', 'REVIEW_REQUIRED'),
    ('DRAFT', 'APPROVED'),
    ('REVIEW_REQUIRED', 'APPROVED')
  ) then
    null;
  else
    raise exception 'invalid transform plan status transition % -> %', old.status, new.status
      using errcode = '55000';
  end if;

  if new.row_version is distinct from old.row_version + 1 then
    raise exception 'transform plan row version must advance exactly once'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists transform_plan_status_transition_guard on ingestion.transform_plan;
create trigger transform_plan_status_transition_guard
before update on ingestion.transform_plan
for each row execute function ingestion.guard_transform_plan_status_transition();

create or replace function ingestion.record_job_transition(
  job_row ingestion.job,
  previous_job_status text,
  observed_at timestamptz,
  detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  operation_row service.operation%rowtype;
  operation_status text;
  next_sequence bigint;
  transition_event_id uuid := gen_random_uuid();
  transition_type text := 'data.job.' || lower(job_row.status);
  transition_payload jsonb;
begin
  select operation.*
  into operation_row
  from service.operation as operation
  where operation.tenant_id = job_row.tenant_id
    and operation.project_id = job_row.project_id
    and operation.operation_id = job_row.operation_id
  for update;

  if not found then
    raise exception 'operation % for job % was not found', job_row.operation_id, job_row.job_id
      using errcode = '23503';
  end if;

  if job_row.security_level is distinct from operation_row.security_level
     or job_row.policy_version is distinct from operation_row.policy_version then
    raise exception 'job and operation security context must match'
      using errcode = '42501';
  end if;

  operation_status := case
    when operation_row.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then operation_row.status
    when exists (
      select 1 from ingestion.job as sibling
      where sibling.tenant_id = job_row.tenant_id
        and sibling.project_id = job_row.project_id
        and sibling.operation_id = job_row.operation_id
        and sibling.status in ('FAILED', 'DEAD_LETTER')
    ) then 'FAILED'
    when exists (
      select 1 from ingestion.job as sibling
      where sibling.tenant_id = job_row.tenant_id
        and sibling.project_id = job_row.project_id
        and sibling.operation_id = job_row.operation_id
        and sibling.status = 'CANCELLED'
    ) then 'CANCELLED'
    when not exists (
      select 1 from ingestion.job as sibling
      where sibling.tenant_id = job_row.tenant_id
        and sibling.project_id = job_row.project_id
        and sibling.operation_id = job_row.operation_id
        and sibling.status <> 'SUCCEEDED'
    ) then 'SUCCEEDED'
    when exists (
      select 1 from ingestion.job as sibling
      where sibling.tenant_id = job_row.tenant_id
        and sibling.project_id = job_row.project_id
        and sibling.operation_id = job_row.operation_id
        and sibling.status = 'WAITING_INPUT'
    ) then 'WAITING_INPUT'
    when exists (
      select 1 from ingestion.job as sibling
      where sibling.tenant_id = job_row.tenant_id
        and sibling.project_id = job_row.project_id
        and sibling.operation_id = job_row.operation_id
        and sibling.status = 'WAITING_REVIEW'
    ) then 'WAITING_REVIEW'
    else 'RUNNING'
  end;

  transition_type := case
    when operation_status = operation_row.status then 'PROGRESS_REPORTED'
    when operation_status = 'RUNNING' then 'STARTED'
    when operation_status = 'WAITING_INPUT' then 'WAITING_INPUT'
    when operation_status = 'WAITING_REVIEW' then 'WAITING_REVIEW'
    when operation_status = 'SUCCEEDED' then 'SUCCEEDED'
    when operation_status = 'FAILED' then 'FAILED'
    when operation_status = 'CANCELLED' then 'CANCELLED'
    else 'PROGRESS_REPORTED'
  end;

  select coalesce(max(operation_event.sequence_number), 0) + 1
  into next_sequence
  from service.operation_event as operation_event
  where operation_event.tenant_id = job_row.tenant_id
    and operation_event.project_id = job_row.project_id
    and operation_event.operation_id = job_row.operation_id;

  transition_payload := jsonb_build_object(
    'jobId', job_row.job_id,
    'jobType', job_row.job_type,
    'jobStatus', job_row.status,
    'previousJobStatus', previous_job_status,
    'jobRowVersion', job_row.row_version,
    'attemptCount', job_row.attempt_count,
    'detail', coalesce(detail, '{}'::jsonb)
  );

  if operation_row.status not in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
    update service.operation
    set status = operation_status,
        progress_percent = case
          when operation_status = 'SUCCEEDED' then 100
          else progress_percent
        end,
        result_payload = case
          when operation_status = 'SUCCEEDED' then detail -> 'result'
          else result_payload
        end,
        error_code = case
          when operation_status = 'FAILED' then job_row.error_category
          else null
        end,
        error_message = case
          when operation_status = 'FAILED' then job_row.last_error_detail ->> 'message'
          else null
        end,
        error_retryable = case
          when operation_status = 'FAILED' then false
          else null
        end,
        started_at = coalesce(started_at, observed_at),
        completed_at = case
          when operation_status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then observed_at
          else null
        end,
        row_version = row_version + 1,
        updated_at = observed_at
    where tenant_id = job_row.tenant_id
      and project_id = job_row.project_id
      and operation_id = job_row.operation_id;
  end if;

  insert into service.operation_event (
    tenant_id,
    project_id,
    operation_id,
    event_id,
    sequence_number,
    from_status,
    to_status,
    event_type,
    payload,
    security_level,
    policy_version,
    row_version,
    created_at
  )
  values (
    job_row.tenant_id,
    job_row.project_id,
    job_row.operation_id,
    transition_event_id,
    next_sequence,
    operation_row.status,
    operation_status,
    transition_type,
    transition_payload,
    operation_row.security_level,
    operation_row.policy_version,
    1,
    observed_at
  );

  insert into event.outbox_event (
    tenant_id,
    project_id,
    event_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    headers,
    idempotency_key,
    available_at,
    security_level,
    policy_version,
    row_version,
    created_at
  )
  values (
    job_row.tenant_id,
    job_row.project_id,
    transition_event_id,
    'data-job',
    job_row.job_id::text,
    'data.job.' || lower(job_row.status),
    transition_payload,
    jsonb_build_object('operationId', job_row.operation_id),
    format('job:%s:row_version:%s:status:%s', job_row.job_id, job_row.row_version, job_row.status),
    observed_at,
    operation_row.security_level,
    operation_row.policy_version,
    1,
    observed_at
  );
end;
$$;

drop function if exists ingestion.claim_jobs(uuid, uuid, text, interval, integer);

create or replace function ingestion.claim_jobs_at(
  requested_tenant_id uuid,
  requested_project_id uuid,
  worker_id text,
  lease_duration interval,
  batch_size integer,
  observed_at timestamptz
)
returns setof ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  claimed_job ingestion.job%rowtype;
  claimed_record record;
begin
  if requested_tenant_id is distinct from security.current_tenant_id()
     or requested_project_id is distinct from security.current_project_id() then
    raise exception 'job claim scope does not match the authorized database context'
      using errcode = '42501';
  end if;
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  if observed_at is null
     or lease_duration is null
     or lease_duration <= interval '0 seconds'
     or lease_duration > interval '15 minutes'
     or batch_size is null
     or batch_size < 1
     or batch_size > 100 then
    raise exception 'invalid claim time, lease duration, or batch size'
      using errcode = '22023';
  end if;

  -- Claim rows first, then acquire their Operation locks in a deterministic
  -- order while retaining the real pre-claim status for durable events.
  for claimed_record in
    with candidates as (
      select candidate.job_id, candidate.status as previous_job_status
      from ingestion.job as candidate
      where candidate.tenant_id = requested_tenant_id
        and candidate.project_id = requested_project_id
        and candidate.cancel_requested_at is null
        and candidate.attempt_count < candidate.max_attempts
        and candidate.next_attempt_at <= clock_timestamp()
        and (candidate.timeout_at is null or candidate.timeout_at > clock_timestamp())
        and candidate.status in ('PENDING', 'RETRY_SCHEDULED')
        and exists (
          select 1
          from service.operation as operation
          where operation.tenant_id = candidate.tenant_id
            and operation.project_id = candidate.project_id
            and operation.operation_id = candidate.operation_id
            and operation.status not in ('SUCCEEDED', 'FAILED', 'CANCELLED')
        )
        and (
          candidate.depends_on_job_id is null
          or exists (
            select 1
            from ingestion.job as dependency
            where dependency.job_id = candidate.depends_on_job_id
              and dependency.tenant_id = candidate.tenant_id
              and dependency.project_id = candidate.project_id
              and dependency.status = 'SUCCEEDED'
          )
        )
      order by candidate.priority desc, candidate.next_attempt_at, candidate.created_at
      for update skip locked
      limit batch_size
    ), claimed_rows as (
      update ingestion.job as claimed
      set status = 'RUNNING',
          lease_owner = worker_id,
          lease_expires_at = least(
            clock_timestamp() + lease_duration,
            coalesce(claimed.timeout_at, 'infinity'::timestamptz)
          ),
          heartbeat_at = clock_timestamp(),
          attempt_count = claimed.attempt_count + 1,
          error_category = null,
          last_error_detail = null,
          row_version = claimed.row_version + 1,
          updated_at = observed_at
      from candidates
      where claimed.job_id = candidates.job_id
      returning claimed.job_id,
        claimed.operation_id,
        candidates.previous_job_status
    )
    select claimed_rows.*
    from claimed_rows
    order by claimed_rows.operation_id, claimed_rows.job_id
  loop
    select candidate.*
    into strict claimed_job
    from ingestion.job as candidate
    where candidate.tenant_id = requested_tenant_id
      and candidate.project_id = requested_project_id
      and candidate.job_id = claimed_record.job_id;

    insert into ingestion.job_attempt (
      tenant_id,
      project_id,
      job_id,
      attempt_number,
      worker_id,
      started_at,
      security_level,
      policy_version,
      row_version,
      created_at,
      updated_at
    )
    values (
      claimed_job.tenant_id,
      claimed_job.project_id,
      claimed_job.job_id,
      claimed_job.attempt_count,
      worker_id,
      observed_at,
      claimed_job.security_level,
      claimed_job.policy_version,
      1,
      observed_at,
      observed_at
    );

    perform ingestion.record_job_transition(
      claimed_job,
      claimed_record.previous_job_status,
      observed_at,
      jsonb_build_object('workerId', worker_id)
    );
    return next claimed_job;
  end loop;
  return;
end;
$$;

revoke all on function service.guard_operation_status_transition() from public;
revoke all on function ingestion.guard_session_state_transition() from public;
revoke all on function ingestion.guard_job_status_transition() from public;
revoke all on function ingestion.guard_transform_plan_status_transition() from public;
revoke all on function ingestion.record_job_transition(ingestion.job, text, timestamptz, jsonb) from public;
revoke all on function ingestion.claim_jobs_at(uuid, uuid, text, interval, integer, timestamptz) from public;
