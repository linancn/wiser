import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const MIGRATION_FILENAME = /^(?<version>\d{4})_[a-z][a-z0-9_]*\.sql$/;
const MIGRATION_LOCK_NAME = 'wiser:data-foundation:schema-migrations:v1';

const CREATE_MIGRATION_TABLE_SQL = `
create table if not exists public.schema_migrations (
  version text primary key,
  filename text not null unique,
  checksum text not null,
  applied_at timestamptz not null default clock_timestamp(),
  constraint schema_migrations_version_format check (version ~ '^[0-9]{4}$'),
  constraint schema_migrations_checksum_format check (checksum ~ '^[a-f0-9]{64}$')
)
`;

const READ_APPLIED_MIGRATIONS_SQL = `
select version, filename, checksum
from public.schema_migrations
order by version
`;

const RECORD_MIGRATION_SQL = `
insert into public.schema_migrations (version, filename, checksum)
values ($1, $2, $3)
`;

export interface Migration {
  readonly version: string;
  readonly filename: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<MigrationQueryResult>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface RunMigrationsOptions {
  readonly directory: string;
  readonly pool: MigrationPool;
}

export interface MigrationRunResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

interface AppliedMigration {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

export class MigrationDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationDiscoveryError';
  }
}

export class MigrationDriftError extends Error {
  constructor(
    readonly version: string,
    readonly filename: string,
    message: string,
  ) {
    super(message);
    this.name = 'MigrationDriftError';
  }
}

export function calculateMigrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function discoverMigrations(
  directory: string,
): Promise<readonly Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: Array<{
    readonly version: string;
    readonly filename: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      continue;
    }
    const match = MIGRATION_FILENAME.exec(entry.name);
    const version = match?.groups?.version;
    if (version === undefined) {
      throw new MigrationDiscoveryError(
        `Migration ${entry.name} must match NNNN_descriptive_name.sql.`,
      );
    }
    candidates.push({ version, filename: entry.name });
  }

  candidates.sort((left, right) => left.filename.localeCompare(right.filename));
  const versions = new Set<string>();
  const migrations: Migration[] = [];
  for (const candidate of candidates) {
    if (versions.has(candidate.version)) {
      throw new MigrationDiscoveryError(
        `Duplicate migration version ${candidate.version}.`,
      );
    }
    versions.add(candidate.version);
    const path = resolve(directory, candidate.filename);
    const sql = await readFile(path, 'utf8');
    migrations.push(
      Object.freeze({
        ...candidate,
        path,
        sql,
        checksum: calculateMigrationChecksum(sql),
      }),
    );
  }

  return Object.freeze(migrations);
}

function requiredString(
  row: Readonly<Record<string, unknown>>,
  field: keyof AppliedMigration,
): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MigrationDriftError(
      typeof row.version === 'string' ? row.version : 'unknown',
      typeof row.filename === 'string' ? row.filename : 'unknown',
      `schema_migrations contains an invalid ${field}.`,
    );
  }
  return value;
}

function parseAppliedMigrations(
  rows: readonly Record<string, unknown>[],
): readonly AppliedMigration[] {
  return rows.map((row) => ({
    version: requiredString(row, 'version'),
    filename: requiredString(row, 'filename'),
    checksum: requiredString(row, 'checksum'),
  }));
}

function assertMigrationHistory(
  migrations: readonly Migration[],
  appliedMigrations: readonly AppliedMigration[],
): ReadonlySet<string> {
  const discoveredByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  const appliedVersions = new Set<string>();

  for (const [index, applied] of appliedMigrations.entries()) {
    const discovered = discoveredByVersion.get(applied.version);
    if (discovered === undefined) {
      throw new MigrationDriftError(
        applied.version,
        applied.filename,
        `Applied migration ${applied.filename} is missing from the migration directory.`,
      );
    }
    if (
      discovered.filename !== applied.filename ||
      discovered.checksum !== applied.checksum
    ) {
      throw new MigrationDriftError(
        applied.version,
        applied.filename,
        `Applied migration ${applied.filename} no longer matches its filename or SHA-256 checksum.`,
      );
    }
    if (migrations[index]?.version !== applied.version) {
      throw new MigrationDriftError(
        applied.version,
        applied.filename,
        `Applied migration history is not a contiguous prefix at ${applied.filename}.`,
      );
    }
    appliedVersions.add(applied.version);
  }

  return appliedVersions;
}

async function applyMigration(
  client: MigrationClient,
  migration: Migration,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(RECORD_MIGRATION_SQL, [
      migration.version,
      migration.filename,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      if (error instanceof Error) {
        error.message = `${error.message} (rollback also failed)`;
      }
      throw error;
    }
    throw error;
  }
}

export async function runMigrations(
  options: RunMigrationsOptions,
): Promise<MigrationRunResult> {
  const migrations = await discoverMigrations(options.directory);
  const client = await options.pool.connect();
  let locked = false;

  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [
      MIGRATION_LOCK_NAME,
    ]);
    locked = true;
    await client.query(CREATE_MIGRATION_TABLE_SQL);
    const appliedResult = await client.query(READ_APPLIED_MIGRATIONS_SQL);
    const appliedVersions = assertMigrationHistory(
      migrations,
      parseAppliedMigrations(appliedResult.rows),
    );

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        skipped.push(migration.filename);
        continue;
      }
      await applyMigration(client, migration);
      applied.push(migration.filename);
    }

    return Object.freeze({
      applied: Object.freeze(applied),
      skipped: Object.freeze(skipped),
    });
  } finally {
    try {
      if (locked) {
        await client.query('select pg_advisory_unlock(hashtext($1))', [
          MIGRATION_LOCK_NAME,
        ]);
      }
    } finally {
      client.release();
    }
  }
}
