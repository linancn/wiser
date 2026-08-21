import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = () =>
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../infrastructure/data-foundation/postgres/migrations/0006_content_lifecycle_constraints.sql',
    ),
    'utf8',
  );

describe('content lifecycle forward constraints', () => {
  it('rejects invalid Asset state on INSERT as well as mutation', () => {
    expect(sql()).toMatch(/asset_lifecycle_state_check/i);
    expect(sql()).toMatch(
      /lifecycle_state in \('QUARANTINED', 'FINGERPRINTED', 'RAW'\)/i,
    );
    expect(sql()).toMatch(
      /update catalog\.asset[\s\S]*set lifecycle_state = 'FINGERPRINTED',[\s\S]*row_version = row_version \+ 1/i,
    );
  });

  it('makes Blob lifecycle and raw storage key mutually consistent', () => {
    expect(sql()).toMatch(/content_blob_storage_state_check/i);
    expect(sql()).toMatch(/raw_storage_key is null/i);
    expect(sql()).toMatch(/raw_storage_key is not null/i);
  });
});
