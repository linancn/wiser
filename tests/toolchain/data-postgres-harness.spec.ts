import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

describe('Data PostgreSQL integration harnesses', () => {
  it('uses a direct, pinned PostgreSQL test dependency in Data Worker', () => {
    const manifest = readJson('apps/data-worker/package.json');
    const dependencies = manifest.devDependencies as Record<string, string>;
    const source = read(
      'apps/data-worker/test/ingestion-runtime-adapters.spec.ts',
    );

    expect(dependencies.pg).toBe('8.23.0');
    expect(dependencies['@types/pg']).toBe('8.23.1');
    expect(source).toContain("import { Pool } from 'pg';");
    expect(source).not.toContain('createRequire');
    expect(source).not.toContain('packages/data-infra/node_modules/pg');
  });

  it('bounds real connections and uses collision-free authority fixtures', () => {
    const source = read(
      'apps/data-worker/test/ingestion-runtime-adapters.spec.ts',
    );

    expect(source).toContain("import { randomUUID } from 'node:crypto';");
    expect(source).toContain('connectionTimeoutMillis: 5_000');
    expect(source).toContain('query_timeout: 30_000');
    expect(source).toContain('statement_timeout: 30_000');
    expect(source).not.toContain(
      "const smokeTenant = 'a1111111-1111-4111-8111-111111111111'",
    );
    expect(source).toMatch(/const smokeTenant = randomUUID\(\)/);
    expect(source).toMatch(/\},\s*60_000,\s*\);/s);
  });

  it('rolls back and releases the verification client on every exit path', () => {
    const source = read(
      'apps/data-worker/test/ingestion-runtime-adapters.spec.ts',
    );

    expect(source).toMatch(
      /finally \{\s*try \{\s*await verify\.query\('ROLLBACK'\);\s*\} finally \{\s*verify\.release\(\);/s,
    );
  });

  it('requires an explicit owner DSN when the API integration is enabled', () => {
    const source = read(
      'apps/api/test/data-postgres-command-executors.spec.ts',
    );

    expect(source).not.toContain(
      'postgresql://wiser_data:wiser-local-data-4f8c71b0f3e947d4@127.0.0.1:55432/wiser_data',
    );
    expect(source).toContain('DATA_TEST_DATABASE_URL is required');
    expect(source).toContain('connectionTimeoutMillis: 5_000');
    expect(source).toMatch(/\},\s*60_000,\s*\);/s);
  });
});
