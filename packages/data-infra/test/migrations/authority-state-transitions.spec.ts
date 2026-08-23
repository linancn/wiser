import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  import.meta.dirname,
  '../../../../infrastructure/data-foundation/postgres/migrations/0009_authority_state_transition_guards.sql',
);

function migration(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('authority state transition guards', () => {
  it('guards Operation, Ingestion, Job, and Transform Plan mutations', () => {
    const sql = migration();

    for (const trigger of [
      'operation_status_transition_guard',
      'ingestion_session_state_transition_guard',
      'ingestion_job_status_transition_guard',
      'transform_plan_status_transition_guard',
    ]) {
      expect(sql).toContain(trigger);
    }
    for (const relation of [
      'service.operation',
      'ingestion.session',
      'ingestion.job',
      'ingestion.transform_plan',
    ]) {
      expect(sql.toLowerCase()).toContain(`before update on ${relation}`);
    }
    for (const message of [
      'invalid operation status transition',
      'invalid ingestion state transition',
      'invalid job status transition',
    ]) {
      expect(sql).toContain(message);
    }
    expect(sql).toContain('transform_plan_status_check');
  });

  it('preserves only legitimate same-state work and the upload completion edge', () => {
    const sql = migration();

    expect(sql).toMatch(/new\.status is not distinct from old\.status/i);
    expect(sql).not.toMatch(/new\.state is not distinct from old\.state/i);
    expect(sql).toContain("old.status = 'RUNNING'");
    expect(sql).toContain("old.status = 'WAITING_INPUT'");
    expect(sql).toContain("new.status = 'SUCCEEDED'");
    expect(sql).toContain("old.capability_id = 'data.uploadSession.create'");
  });

  it('protects authority identity, security context, and optimistic versions', () => {
    const sql = migration();

    for (const immutableField of [
      'new.tenant_id is distinct from old.tenant_id',
      'new.project_id is distinct from old.project_id',
      'new.policy_version is distinct from old.policy_version',
      'new.created_at is distinct from old.created_at',
    ]) {
      expect(sql).toContain(immutableField);
    }
    expect(sql).toContain('security.security_rank(new.security_level)');
    expect(sql).toMatch(
      /new\.row_version is distinct from old\.row_version \+ 1/,
    );
    expect(sql).toContain("errcode = '40001'");
    expect(sql).toContain("errcode = '42501'");
    for (const constraint of [
      'operation_authority_versions_positive',
      'ingestion_session_authority_versions_positive',
      'ingestion_job_authority_versions_positive',
      'transform_plan_authority_versions_positive',
    ]) {
      expect(sql).toContain(constraint);
    }
  });

  it('retires the legacy claim path and records the actual previous job status', () => {
    const sql = migration();

    expect(sql).toMatch(
      /drop function if exists ingestion\.claim_jobs\(uuid, uuid, text, interval, integer\)/i,
    );
    expect(sql).toMatch(/create or replace function ingestion\.claim_jobs_at/i);
    expect(sql).toContain('previous_job_status');
    expect(sql).not.toContain(
      "case when claimed_job.attempt_count = 1 then 'PENDING' else 'RETRY_SCHEDULED' end",
    );
  });

  it('limits same-state mutations to lifecycle progress rather than authority content', () => {
    const sql = migration();

    expect(sql).toContain('terminal operation content is immutable');
    expect(sql).toContain('invalid same-state operation mutation');
    expect(sql).toContain(
      'invalid running job heartbeat or cancellation mutation',
    );
    expect(sql).toContain(
      'new.result_payload is distinct from old.result_payload',
    );
    expect(sql).toContain('new.lease_owner is distinct from old.lease_owner');
    expect(sql).toContain(
      'new.cancel_requested_at is distinct from old.cancel_requested_at',
    );
  });

  it('allows sibling-job aggregation to move between waiting states', () => {
    const sql = migration();

    expect(sql).toContain("('WAITING_INPUT', 'WAITING_REVIEW')");
    expect(sql).toContain("('WAITING_REVIEW', 'WAITING_INPUT')");
  });

  it('keeps terminal states terminal and functions non-public', () => {
    const sql = migration();

    for (const terminal of [
      'PUBLISHED',
      'REJECTED',
      'SUCCEEDED',
      'DEAD_LETTER',
    ]) {
      expect(sql).toContain(`'${terminal}'`);
    }
    expect(sql).toMatch(/set search_path = pg_catalog/i);
    expect(sql).toMatch(/revoke all on function .* from public/i);
  });
});
