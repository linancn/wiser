import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = resolve(
  import.meta.dirname,
  '../../../infrastructure/data-foundation/postgres/migrations/0004_job_lifecycle.sql',
);

let sql = '';

beforeAll(async () => {
  sql = await readFile(MIGRATION, 'utf8');
});

describe('durable Data Worker SQL lifecycle', () => {
  it('claims jobs concurrently with leases, attempts, and deterministic time', () => {
    expect(sql).toMatch(/function ingestion\.claim_jobs_at/i);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/lease_owner = worker_id/i);
    expect(sql).toMatch(/lease_expires_at = observed_at \+ lease_duration/i);
    expect(sql).toMatch(/insert into ingestion\.job_attempt/i);
  });

  it('rejects stale leases using owner, expiry, and optimistic row version', () => {
    expect(sql).toMatch(/function ingestion\.heartbeat_job/i);
    expect(sql).toMatch(/lease_owner = worker_id/i);
    expect(sql).toMatch(/lease_expires_at > observed_at/i);
    expect(sql).toMatch(/row_version = expected_row_version/i);
    expect(sql).toMatch(/raise exception 'job lease lost/i);
  });

  it('supports capped exponential retry, dead letters, cancellation, and wait states', () => {
    expect(sql).toMatch(/function ingestion\.retry_delay_seconds/i);
    expect(sql).toMatch(/power\(2::numeric/i);
    expect(sql).toContain("'RETRY_SCHEDULED'");
    expect(sql).toContain("'DEAD_LETTER'");
    expect(sql).toContain("'CANCELLED'");
    expect(sql).toContain("'WAITING_INPUT'");
    expect(sql).toContain("'WAITING_REVIEW'");
    expect(sql).toMatch(/cancel_requested_at/i);
  });

  it('recovers expired leases and hard timeouts without blocking active workers', () => {
    expect(sql).toMatch(/function ingestion\.recover_jobs/i);
    expect(sql).toMatch(/lease_expires_at <= observed_at/i);
    expect(sql).toMatch(/timeout_at <= observed_at/i);
    expect(sql).toMatch(/for update skip locked/i);
  });

  it('records every transition in immutable Operation events and Transactional Outbox', () => {
    expect(sql).toMatch(/function ingestion\.record_job_transition/i);
    expect(sql).toMatch(/insert into service\.operation_event/i);
    expect(sql).toMatch(/insert into event\.outbox_event/i);
    expect(sql).toMatch(/update service\.operation/i);
    expect(sql).toMatch(/job_id.*row_version.*status/is);
  });

  it('keeps lifecycle functions security-invoker, search-path safe, and non-public', () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = pg_catalog/i);
    expect(sql).toMatch(/revoke all on function ingestion\.claim_jobs_at/i);
    expect(sql).not.toMatch(/\b(?:redis|kafka|nats|valkey|bullmq|temporal)\b/i);
  });
});
