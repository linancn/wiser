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
    for (const message of [
      'invalid operation status transition',
      'invalid ingestion state transition',
      'invalid job status transition',
    ]) {
      expect(sql).toContain(message);
    }
    expect(sql).toContain('transform_plan_status_check');
  });

  it('preserves legitimate same-state work and the upload completion edge', () => {
    const sql = migration();

    expect(sql).toMatch(/new\.status is not distinct from old\.status/i);
    expect(sql).toMatch(/new\.state is not distinct from old\.state/i);
    expect(sql).toContain("old.status = 'WAITING_INPUT'");
    expect(sql).toContain("new.status = 'SUCCEEDED'");
    expect(sql).toContain("old.capability_id = 'data.uploadSession.create'");
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
