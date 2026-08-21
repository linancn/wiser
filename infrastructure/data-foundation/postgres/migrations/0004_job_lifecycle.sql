alter table ingestion.job
  add column backoff_max_seconds integer not null default 3600,
  add column last_error_detail jsonb,
  add column completed_at timestamptz,
  add constraint ingestion_job_backoff_max
    check (backoff_max_seconds >= backoff_base_seconds);

create index ingestion_job_recovery_idx
  on ingestion.job (tenant_id, project_id, lease_expires_at, timeout_at)
  where status in ('RUNNING', 'WAITING_INPUT', 'WAITING_REVIEW');

create or replace function ingestion.retry_delay_seconds(
  attempt_count integer,
  base_seconds integer,
  maximum_seconds integer
)
returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if attempt_count < 1
     or base_seconds < 1
     or maximum_seconds < base_seconds then
    raise exception 'invalid exponential retry parameters' using errcode = '22023';
  end if;

  return least(
    maximum_seconds::numeric,
    base_seconds::numeric * power(2::numeric, greatest(attempt_count - 1, 0))
  )::integer;
end;
$$;

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

  -- Job rows are selected by scheduling priority, then their Operation locks are
  -- acquired in one deterministic order to prevent cross-batch deadlocks.
  for claimed_job in
    with candidates as (
      select candidate.job_id
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
      returning claimed.*
    )
    select claimed_rows.*
    from claimed_rows
    order by claimed_rows.operation_id, claimed_rows.job_id
  loop
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
      case when claimed_job.attempt_count = 1 then 'PENDING' else 'RETRY_SCHEDULED' end,
      observed_at,
      jsonb_build_object('workerId', worker_id)
    );
    return next claimed_job;
  end loop;
  return;
end;
$$;

create or replace function ingestion.heartbeat_job(
  requested_tenant_id uuid,
  requested_project_id uuid,
  requested_job_id uuid,
  worker_id text,
  expected_row_version bigint,
  lease_duration interval,
  observed_at timestamptz
)
returns ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  heartbeat_job ingestion.job%rowtype;
begin
  if lease_duration is null
     or lease_duration <= interval '0 seconds'
     or lease_duration > interval '15 minutes'
     or observed_at is null then
    raise exception 'invalid heartbeat time or lease duration' using errcode = '22023';
  end if;

  update ingestion.job as candidate
  set heartbeat_at = observed_at,
      lease_expires_at = least(
        clock_timestamp() + lease_duration,
        coalesce(candidate.timeout_at, 'infinity'::timestamptz)
      ),
      row_version = candidate.row_version + 1,
      updated_at = observed_at
  where candidate.tenant_id = requested_tenant_id
    and candidate.project_id = requested_project_id
    and candidate.job_id = requested_job_id
    and candidate.status = 'RUNNING'
    and candidate.lease_owner = worker_id
    and candidate.lease_expires_at > clock_timestamp()
    and (candidate.timeout_at is null or candidate.timeout_at > clock_timestamp())
    and candidate.row_version = expected_row_version
  returning candidate.* into heartbeat_job;

  if not found then
    raise exception 'job lease lost for %', requested_job_id using errcode = '55000';
  end if;
  return heartbeat_job;
end;
$$;

create or replace function ingestion.settle_job(
  requested_tenant_id uuid,
  requested_project_id uuid,
  requested_job_id uuid,
  worker_id text,
  expected_row_version bigint,
  requested_status text,
  result_payload jsonb,
  observed_at timestamptz
)
returns ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  current_job ingestion.job%rowtype;
  settled_job ingestion.job%rowtype;
  target_status text;
begin
  if requested_status not in ('SUCCEEDED', 'WAITING_INPUT', 'WAITING_REVIEW', 'CANCELLED') then
    raise exception 'unsupported job settlement status %', requested_status
      using errcode = '22023';
  end if;

  select candidate.*
  into current_job
  from ingestion.job as candidate
  where candidate.tenant_id = requested_tenant_id
    and candidate.project_id = requested_project_id
    and candidate.job_id = requested_job_id
    and candidate.status = 'RUNNING'
    and candidate.lease_owner = worker_id
    and candidate.lease_expires_at > clock_timestamp()
    and (candidate.timeout_at is null or candidate.timeout_at > clock_timestamp())
    and candidate.row_version = expected_row_version
  for update;

  if not found then
    raise exception 'job lease lost for %', requested_job_id using errcode = '55000';
  end if;

  target_status := case
    when current_job.cancel_requested_at is not null then 'CANCELLED'
    else requested_status
  end;

  update ingestion.job as candidate
  set status = target_status,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      completed_at = case
        when target_status in ('SUCCEEDED', 'CANCELLED') then observed_at
        else null
      end,
      row_version = candidate.row_version + 1,
      updated_at = observed_at
  where candidate.job_id = current_job.job_id
  returning candidate.* into settled_job;

  update ingestion.job_attempt
  set outcome = target_status,
      finished_at = observed_at,
      row_version = row_version + 1,
      updated_at = observed_at
  where tenant_id = current_job.tenant_id
    and project_id = current_job.project_id
    and job_id = current_job.job_id
    and attempt_number = current_job.attempt_count;

  perform ingestion.record_job_transition(
    settled_job,
    current_job.status,
    observed_at,
    jsonb_build_object('result', coalesce(result_payload, '{}'::jsonb))
  );
  return settled_job;
end;
$$;

create or replace function ingestion.fail_job(
  requested_tenant_id uuid,
  requested_project_id uuid,
  requested_job_id uuid,
  worker_id text,
  expected_row_version bigint,
  failure_category text,
  retryable boolean,
  failure_detail jsonb,
  observed_at timestamptz
)
returns ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  current_job ingestion.job%rowtype;
  failed_job ingestion.job%rowtype;
  target_status text;
  retry_seconds integer;
begin
  select candidate.*
  into current_job
  from ingestion.job as candidate
  where candidate.tenant_id = requested_tenant_id
    and candidate.project_id = requested_project_id
    and candidate.job_id = requested_job_id
    and candidate.status = 'RUNNING'
    and candidate.lease_owner = worker_id
    and candidate.lease_expires_at > clock_timestamp()
    and (candidate.timeout_at is null or candidate.timeout_at > clock_timestamp())
    and candidate.row_version = expected_row_version
  for update;

  if not found then
    raise exception 'job lease lost for %', requested_job_id using errcode = '55000';
  end if;

  target_status := case
    when current_job.cancel_requested_at is not null then 'CANCELLED'
    when not retryable then 'FAILED'
    when current_job.attempt_count >= current_job.max_attempts then 'DEAD_LETTER'
    else 'RETRY_SCHEDULED'
  end;
  retry_seconds := ingestion.retry_delay_seconds(
    current_job.attempt_count,
    current_job.backoff_base_seconds,
    current_job.backoff_max_seconds
  );

  update ingestion.job as candidate
  set status = target_status,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      next_attempt_at = case
        when target_status = 'RETRY_SCHEDULED' then observed_at + retry_seconds * interval '1 second'
        else candidate.next_attempt_at
      end,
      error_category = failure_category,
      last_error_detail = coalesce(failure_detail, '{}'::jsonb),
      completed_at = case
        when target_status in ('FAILED', 'DEAD_LETTER', 'CANCELLED') then observed_at
        else null
      end,
      row_version = candidate.row_version + 1,
      updated_at = observed_at
  where candidate.job_id = current_job.job_id
  returning candidate.* into failed_job;

  update ingestion.job_attempt
  set outcome = target_status,
      error_category = failure_category,
      error_detail = coalesce(failure_detail, '{}'::jsonb),
      finished_at = observed_at,
      row_version = row_version + 1,
      updated_at = observed_at
  where tenant_id = current_job.tenant_id
    and project_id = current_job.project_id
    and job_id = current_job.job_id
    and attempt_number = current_job.attempt_count;

  perform ingestion.record_job_transition(
    failed_job,
    current_job.status,
    observed_at,
    jsonb_build_object(
      'errorCategory', failure_category,
      'retryable', retryable,
      'nextAttemptAt', failed_job.next_attempt_at,
      'failure', coalesce(failure_detail, '{}'::jsonb)
    )
  );
  return failed_job;
end;
$$;

create or replace function ingestion.request_job_cancellation(
  requested_tenant_id uuid,
  requested_project_id uuid,
  requested_job_id uuid,
  observed_at timestamptz
)
returns ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  current_job ingestion.job%rowtype;
  cancelled_job ingestion.job%rowtype;
begin
  select candidate.*
  into current_job
  from ingestion.job as candidate
  where candidate.tenant_id = requested_tenant_id
    and candidate.project_id = requested_project_id
    and candidate.job_id = requested_job_id
  for update;

  if not found then
    raise exception 'job % was not found', requested_job_id using errcode = 'P0002';
  end if;
  if current_job.status in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER') then
    return current_job;
  end if;

  update ingestion.job as candidate
  set cancel_requested_at = coalesce(candidate.cancel_requested_at, observed_at),
      status = case when candidate.status = 'RUNNING' then candidate.status else 'CANCELLED' end,
      completed_at = case when candidate.status = 'RUNNING' then null else observed_at end,
      row_version = candidate.row_version + 1,
      updated_at = observed_at
  where candidate.job_id = current_job.job_id
  returning candidate.* into cancelled_job;

  perform ingestion.record_job_transition(
    cancelled_job,
    current_job.status,
    observed_at,
    jsonb_build_object('cancellationRequested', true)
  );
  return cancelled_job;
end;
$$;

create or replace function ingestion.recover_jobs(
  requested_tenant_id uuid,
  requested_project_id uuid,
  observed_at timestamptz,
  batch_size integer default 100
)
returns setof ingestion.job
language plpgsql
set search_path = pg_catalog
as $$
declare
  current_job ingestion.job%rowtype;
  recovered_job ingestion.job%rowtype;
  target_status text;
  retry_seconds integer;
begin
  if batch_size is null
     or batch_size < 1
     or batch_size > 1000
     or observed_at is null then
    raise exception 'invalid recovery time or batch size' using errcode = '22023';
  end if;

  for current_job in
    select candidate.*
    from ingestion.job as candidate
    where candidate.tenant_id = requested_tenant_id
      and candidate.project_id = requested_project_id
      and candidate.status not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER')
      and (
        candidate.cancel_requested_at is not null
        or candidate.timeout_at <= observed_at
        or (
          candidate.status = 'RUNNING'
          and candidate.lease_expires_at <= observed_at
        )
      )
    order by candidate.operation_id, candidate.job_id
    for update skip locked
    limit batch_size
  loop
    target_status := case
      when current_job.cancel_requested_at is not null then 'CANCELLED'
      when current_job.timeout_at <= observed_at then 'DEAD_LETTER'
      when current_job.attempt_count >= current_job.max_attempts then 'DEAD_LETTER'
      else 'RETRY_SCHEDULED'
    end;
    retry_seconds := case
      when target_status = 'RETRY_SCHEDULED' then ingestion.retry_delay_seconds(
        current_job.attempt_count,
        current_job.backoff_base_seconds,
        current_job.backoff_max_seconds
      )
      else 0
    end;

    update ingestion.job as candidate
    set status = target_status,
        lease_owner = null,
        lease_expires_at = null,
        heartbeat_at = null,
        next_attempt_at = case
          when target_status = 'RETRY_SCHEDULED' then observed_at + retry_seconds * interval '1 second'
          else candidate.next_attempt_at
        end,
        error_category = case
          when target_status = 'DEAD_LETTER' then 'JOB_TIMEOUT'
          else candidate.error_category
        end,
        last_error_detail = case
          when target_status = 'DEAD_LETTER' then jsonb_build_object('message', 'Job exceeded its timeout or maximum attempts.')
          else candidate.last_error_detail
        end,
        completed_at = case
          when target_status in ('DEAD_LETTER', 'CANCELLED') then observed_at
          else null
        end,
        row_version = candidate.row_version + 1,
        updated_at = observed_at
    where candidate.job_id = current_job.job_id
    returning candidate.* into recovered_job;

    if current_job.status = 'RUNNING' then
      update ingestion.job_attempt
      set outcome = target_status,
          error_category = case
            when target_status = 'DEAD_LETTER' then 'JOB_TIMEOUT'
            else 'LEASE_EXPIRED'
          end,
          finished_at = observed_at,
          row_version = row_version + 1,
          updated_at = observed_at
      where tenant_id = current_job.tenant_id
        and project_id = current_job.project_id
        and job_id = current_job.job_id
        and attempt_number = current_job.attempt_count;
    end if;

    perform ingestion.record_job_transition(
      recovered_job,
      current_job.status,
      observed_at,
      jsonb_build_object('recovered', true)
    );
    return next recovered_job;
  end loop;
  return;
end;
$$;

revoke all on function ingestion.retry_delay_seconds(integer, integer, integer) from public;
revoke all on function ingestion.record_job_transition(ingestion.job, text, timestamptz, jsonb) from public;
revoke all on function ingestion.claim_jobs_at(uuid, uuid, text, interval, integer, timestamptz) from public;
revoke all on function ingestion.heartbeat_job(uuid, uuid, uuid, text, bigint, interval, timestamptz) from public;
revoke all on function ingestion.settle_job(uuid, uuid, uuid, text, bigint, text, jsonb, timestamptz) from public;
revoke all on function ingestion.fail_job(uuid, uuid, uuid, text, bigint, text, boolean, jsonb, timestamptz) from public;
revoke all on function ingestion.request_job_cancellation(uuid, uuid, uuid, timestamptz) from public;
revoke all on function ingestion.recover_jobs(uuid, uuid, timestamptz, integer) from public;
