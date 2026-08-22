import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../../infrastructure/data-foundation/postgres/migrations/0007_version_publication_lifecycle.sql',
  ),
  'utf8',
);

describe('immutable version publication lifecycle migration', () => {
  it('allows only a one-way publication transition while keeping content immutable', () => {
    expect(migration).toContain('data_item_version_publication_guard');
    expect(migration).toMatch(/old\.publication_status = 'UNPUBLISHED'/i);
    expect(migration).toMatch(/new\.publication_status = 'PUBLISHED'/i);
    expect(migration).toMatch(/new\.published_at is not null/i);
    for (const immutableField of [
      'asset_manifest',
      'source_hash',
      'metadata_hash',
      'security_level',
      'policy_version',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `new\\.${immutableField} is not distinct from old\\.${immutableField}`,
          'i',
        ),
      );
    }
    expect(migration).toMatch(/before update or delete/i);
  });
});
