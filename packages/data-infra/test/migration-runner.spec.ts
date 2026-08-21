import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MigrationDriftError,
  calculateMigrationChecksum,
  discoverMigrations,
  runMigrations,
  type MigrationClient,
  type MigrationPool,
} from '../src/index.js';

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

interface AppliedMigrationRow {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

class FakeClient implements MigrationClient {
  readonly queries: RecordedQuery[] = [];
  released = false;

  constructor(
    private readonly applied: readonly AppliedMigrationRow[] = [],
    private readonly failingSql?: string,
  ) {}

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (text === this.failingSql) {
      return Promise.reject(new Error('synthetic migration failure'));
    }
    if (
      /select\s+version,\s*filename,\s*checksum\s+from\s+public\.schema_migrations/i.test(
        text,
      )
    ) {
      return Promise.resolve({ rows: this.applied.map((row) => ({ ...row })) });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements MigrationPool {
  constructor(readonly client: FakeClient) {}

  connect(): Promise<MigrationClient> {
    return Promise.resolve(this.client);
  }
}

async function migrationDirectory(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wiser-data-migrations-'));
  await Promise.all(
    Object.entries(files).map(([filename, sql]) =>
      writeFile(join(directory, filename), sql, 'utf8'),
    ),
  );
  return directory;
}

describe('data-postgres migration discovery', () => {
  it('discovers canonical SQL files in fixed numeric order with SHA-256 checksums', async () => {
    const directory = await migrationDirectory({
      '0002_catalog.sql': 'select 2;\n',
      '0001_bootstrap.sql': 'select 1;\n',
      'README.txt': 'ignored',
    });

    const migrations = await discoverMigrations(directory);

    expect(
      migrations.map(({ version, filename }) => ({ version, filename })),
    ).toEqual([
      { version: '0001', filename: '0001_bootstrap.sql' },
      { version: '0002', filename: '0002_catalog.sql' },
    ]);
    expect(migrations[0]?.checksum).toBe(
      '4a45092ccf992ea92250053a80b931b787924ba61648f420555511b84f10ab6c',
    );
    expect(calculateMigrationChecksum('select 1;\n')).toBe(
      migrations[0]?.checksum,
    );
  });

  it('rejects duplicate numeric versions instead of relying on filesystem order', async () => {
    const directory = await migrationDirectory({
      '0001_bootstrap.sql': 'select 1;',
      '0001_shadow.sql': 'select 2;',
    });

    await expect(discoverMigrations(directory)).rejects.toThrow(
      'Duplicate migration version 0001',
    );
  });
});

describe('data-postgres migration execution', () => {
  it('fails closed on checksum drift before running pending SQL', async () => {
    const directory = await migrationDirectory({
      '0001_bootstrap.sql': 'select 1;\n',
    });
    const client = new FakeClient([
      {
        version: '0001',
        filename: '0001_bootstrap.sql',
        checksum: '0'.repeat(64),
      },
    ]);

    await expect(
      runMigrations({ directory, pool: new FakePool(client) }),
    ).rejects.toBeInstanceOf(MigrationDriftError);

    expect(client.queries.some(({ text }) => text === 'select 1;\n')).toBe(
      false,
    );
    expect(client.queries.at(0)?.text).toMatch(/pg_advisory_lock/);
    expect(client.queries.at(-1)?.text).toMatch(/pg_advisory_unlock/);
    expect(client.released).toBe(true);
  });

  it('rejects a non-prefix history instead of backfilling an earlier migration', async () => {
    const directory = await migrationDirectory({
      '0002_catalog.sql': 'select 2;\n',
      '0001_bootstrap.sql': 'select 1;\n',
    });
    const secondChecksum = calculateMigrationChecksum('select 2;\n');
    const client = new FakeClient([
      {
        version: '0002',
        filename: '0002_catalog.sql',
        checksum: secondChecksum,
      },
    ]);

    await expect(
      runMigrations({ directory, pool: new FakePool(client) }),
    ).rejects.toThrow('not a contiguous prefix');

    expect(client.queries.some(({ text }) => text === 'select 1;\n')).toBe(
      false,
    );
    expect(client.queries.at(-1)?.text).toMatch(/pg_advisory_unlock/);
  });

  it('holds one session advisory lock and commits each file in its own transaction', async () => {
    const directory = await migrationDirectory({
      '0002_catalog.sql': 'select 2;\n',
      '0001_bootstrap.sql': 'select 1;\n',
    });
    const client = new FakeClient();

    const result = await runMigrations({
      directory,
      pool: new FakePool(client),
    });

    expect(result.applied).toEqual(['0001_bootstrap.sql', '0002_catalog.sql']);
    expect(result.skipped).toEqual([]);
    const statements = client.queries.map(({ text }) => text.trim());
    expect(statements.at(0)).toMatch(/^select pg_advisory_lock/);
    expect(statements.filter((text) => text === 'BEGIN')).toHaveLength(2);
    expect(statements.filter((text) => text === 'COMMIT')).toHaveLength(2);
    expect(statements.indexOf('select 1;')).toBeLessThan(
      statements.indexOf('select 2;'),
    );
    expect(statements.at(-1)).toMatch(/^select pg_advisory_unlock/);
    expect(client.released).toBe(true);
  });

  it('rolls back only the failing file and always unlocks and releases the client', async () => {
    const failingSql = 'select broken;\n';
    const directory = await migrationDirectory({
      '0001_broken.sql': failingSql,
    });
    const client = new FakeClient([], failingSql);

    await expect(
      runMigrations({ directory, pool: new FakePool(client) }),
    ).rejects.toThrow('synthetic migration failure');

    const statements = client.queries.map(({ text }) => text.trim());
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(
      statements.some((text) =>
        /^insert into public\.schema_migrations/i.test(text),
      ),
    ).toBe(false);
    expect(statements.at(-1)).toMatch(/^select pg_advisory_unlock/);
    expect(client.released).toBe(true);
  });
});
