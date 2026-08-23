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

function functionDefinition(sql: string, qualifiedName: string): string {
  const marker = `create or replace function ${qualifiedName}`;
  const start = sql.indexOf(marker);
  const end = sql.indexOf('$$;', start);
  if (start < 0 || end < 0) {
    throw new Error(`Missing SQL function definition for ${qualifiedName}.`);
  }
  return sql.slice(start, end + 3);
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
    const guards = [
      functionDefinition(sql, 'service.guard_operation_status_transition'),
      functionDefinition(sql, 'ingestion.guard_session_state_transition'),
      functionDefinition(sql, 'ingestion.guard_job_status_transition'),
      functionDefinition(
        sql,
        'ingestion.guard_transform_plan_status_transition',
      ),
    ];

    for (const guard of guards) {
      for (const immutableField of [
        'new.tenant_id is distinct from old.tenant_id',
        'new.project_id is distinct from old.project_id',
        'new.policy_version is distinct from old.policy_version',
        'new.created_at is distinct from old.created_at',
      ]) {
        expect(guard).toContain(immutableField);
      }
      expect(guard).toMatch(
        /new\.row_version is distinct from old\.row_version \+ 1/,
      );
      expect(guard).toContain("errcode = '40001'");
    }
    expect(guards[0]).toContain('security.security_rank(new.security_level)');
    for (const guard of guards.slice(1)) {
      expect(guard).toContain(
        'new.security_level is distinct from old.security_level',
      );
    }
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
    const claim = functionDefinition(sql, 'ingestion.claim_jobs_at');
    const record = functionDefinition(sql, 'ingestion.record_job_transition');

    expect(sql).toMatch(
      /drop function if exists ingestion\.claim_jobs\(uuid, uuid, text, interval, integer\)/i,
    );
    expect(sql).toMatch(/create or replace function ingestion\.claim_jobs_at/i);
    expect(claim).toContain('candidate.status as previous_job_status');
    expect(claim).toContain('claimed_record.previous_job_status');
    expect(claim).not.toContain(
      "case when claimed_job.attempt_count = 1 then 'PENDING' else 'RETRY_SCHEDULED' end",
    );
    expect(record).toContain(
      "if operation_row.status not in ('SUCCEEDED', 'FAILED', 'CANCELLED') then",
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
