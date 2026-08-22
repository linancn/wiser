import { Buffer } from 'node:buffer';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';

import { parseDelegatedCredentialHmacKeyRing } from '@wiser/platform-auth';

import { InMemoryV2ExerciseService } from './v2-in-memory-service.js';
import {
  createPostgresV2JournalService,
  type PostgresV2JournalServiceOptions,
  type V2JournalClient,
  type V2JournalPool,
  type V2JournalQueryResult,
} from './v2-postgres-journal-service.js';
import type { V2ExerciseService } from './v2-types.js';

const SUPERUSER_DSN_NAME =
  /^(?:postgres(?:[._-].*)?|root|supabase(?:[._-].*)?)$/i;

export type V2RuntimeConfig =
  | { readonly mode: 'memory' }
  | {
      readonly mode: 'postgres';
      readonly databaseUrl: string;
      readonly leaseHmacKeyRing: {
        readonly activeKeyId: string;
        readonly keys: Readonly<Record<string, string>>;
      };
    };

export interface V2RuntimePoolOptions {
  readonly connectionString: string;
  readonly applicationName: 'wiser-excon-v2-journal';
  readonly max: 1;
}

export interface V2RuntimeFactories {
  createPool(options: V2RuntimePoolOptions): V2JournalPool;
  createMemoryService(): V2ExerciseService;
  createPostgresService(
    options: PostgresV2JournalServiceOptions,
  ): Promise<V2ExerciseService>;
}

export interface V2Runtime {
  readonly mode: V2RuntimeConfig['mode'];
  readonly service: V2ExerciseService;
}

const PostgresRuntimeFields = z.strictObject({
  databaseUrl: z.string().min(1).max(8_192),
  leaseHmacKeys: z.string().min(1).max(65_536),
});

function invalid(field: string): Error {
  return new Error(`Invalid Agent EXCON v2 configuration: ${field}.`);
}

function parseDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const username = decodeURIComponent(url.username);
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      username.length === 0 ||
      url.password.length === 0 ||
      url.pathname.length < 2 ||
      url.hash.length > 0 ||
      SUPERUSER_DSN_NAME.test(username)
    ) {
      throw invalid('EXCON_JOURNAL_DATABASE_URL');
    }
    return value;
  } catch {
    throw invalid('EXCON_JOURNAL_DATABASE_URL');
  }
}

function parseLeaseHmacKeyRing(serialized: string) {
  try {
    const parsed = parseDelegatedCredentialHmacKeyRing(serialized);
    return Object.freeze({
      activeKeyId: parsed.activeKeyId,
      keys: Object.freeze(
        Object.fromEntries(
          [...parsed.keys].map(([keyId, key]) => [
            keyId,
            Buffer.from(key).toString('base64url'),
          ]),
        ),
      ),
    });
  } catch {
    throw invalid('EXCON_LEASE_HMAC_KEYS');
  }
}

export function loadV2RuntimeConfig(
  environment: NodeJS.ProcessEnv,
): V2RuntimeConfig {
  const production = environment['NODE_ENV'] === 'production';
  const configuredMode = environment['EXCON_V2_MODE'];
  if (
    configuredMode !== undefined &&
    configuredMode !== 'memory' &&
    configuredMode !== 'postgres'
  ) {
    throw invalid('EXCON_V2_MODE');
  }
  const mode = configuredMode ?? (production ? 'postgres' : 'memory');
  if (mode === 'memory') {
    if (production) {
      throw new Error('EXCON_V2_MODE=memory is forbidden in production.');
    }
    return Object.freeze({ mode });
  }

  const fields = PostgresRuntimeFields.safeParse({
    databaseUrl: environment['EXCON_JOURNAL_DATABASE_URL'],
    leaseHmacKeys: environment['EXCON_LEASE_HMAC_KEYS'],
  });
  if (!fields.success) {
    const field = fields.error.issues[0]?.path[0];
    throw invalid(
      field === 'leaseHmacKeys'
        ? 'EXCON_LEASE_HMAC_KEYS'
        : 'EXCON_JOURNAL_DATABASE_URL',
    );
  }
  return Object.freeze({
    mode,
    databaseUrl: parseDatabaseUrl(fields.data.databaseUrl),
    leaseHmacKeyRing: parseLeaseHmacKeyRing(fields.data.leaseHmacKeys),
  });
}

function journalClient(client: PoolClient): V2JournalClient {
  return {
    async query(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<V2JournalQueryResult> {
      const result = await client.query<QueryResultRow>(text, [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    release() {
      client.release();
    },
  };
}

function createRuntimePool(options: V2RuntimePoolOptions): V2JournalPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  let endPromise: Promise<void> | null = null;
  return {
    async connect() {
      const client = await pool.connect();
      try {
        const role = await client.query<{ readonly rolsuper: boolean }>(`
          select role.rolsuper
          from pg_catalog.pg_roles as role
          where role.rolname = current_user
        `);
        if (role.rows.length !== 1 || role.rows[0]?.rolsuper !== false) {
          throw new Error('Agent EXCON journal requires a non-superuser role.');
        }
        return journalClient(client);
      } catch (error) {
        client.release();
        throw error;
      }
    },
    end() {
      endPromise ??= pool.end();
      return endPromise;
    },
  };
}

const defaultFactories: V2RuntimeFactories = {
  createPool: createRuntimePool,
  createMemoryService: () => new InMemoryV2ExerciseService(),
  createPostgresService: createPostgresV2JournalService,
};

export async function createV2RuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  factories: V2RuntimeFactories = defaultFactories,
): Promise<V2Runtime> {
  const config = loadV2RuntimeConfig(environment);
  if (config.mode === 'memory') {
    return Object.freeze({
      mode: config.mode,
      service: factories.createMemoryService(),
    });
  }

  const pool = factories.createPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-excon-v2-journal',
    max: 1,
  });
  try {
    const service = await factories.createPostgresService({
      pool,
      activeLeaseHmacKeyId: config.leaseHmacKeyRing.activeKeyId,
      leaseHmacKeys: config.leaseHmacKeyRing.keys,
    });
    return Object.freeze({ mode: config.mode, service });
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
