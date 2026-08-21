import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const migrationPath = resolve(
  root,
  'infrastructure/data-foundation/postgres/migrations/0005_content_blob_model.sql',
);

describe('Data Foundation content blob forward migration', () => {
  it('separates deduplicated bytes from per-upload logical Assets', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create table catalog\.content_blob/i);
    expect(sql).toMatch(
      /unique\s*\(tenant_id,\s*project_id,\s*content_hash\)/i,
    );
    expect(sql).toMatch(/alter column content_hash drop not null/i);
    expect(sql).toMatch(/drop constraint.*content_hash_key/i);
    expect(sql).toMatch(/add column content_blob_id uuid/i);
    expect(sql).toMatch(/references catalog\.content_blob/i);
    expect(sql).toMatch(
      /unique\s*\(tenant_id,\s*project_id,\s*asset_id\)/i,
    );
  });

  it('keeps the new authority table forced behind scoped RLS', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/force row level security/i);
    expect(sql).toMatch(/security\.authorized_row/i);
    expect(sql).not.toMatch(/create role|grant .*runtime/i);
  });
});
