import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool, type QueryResult, type QueryResultRow } from 'pg';

import { createV2RuntimeFromEnvironment } from '../../src/v2-runtime.js';
import type { V2ExerciseService } from '../../src/v2-types.js';

const ADMIN_URL_ENVIRONMENT_NAME = 'EXCON_JOURNAL_TEST_ADMIN_URL';
const JOURNAL_MIGRATION_URL = new URL(
  '../../../../supabase/migrations/20260821231215_add_v2_command_journal.sql',
  import.meta.url,
);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface JournalHmacKeyRing {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, string>>;
}

export interface JournalRuntimeLogin {
  readonly roleName: string;
  readonly databaseUrl: string;
}

export interface JournalRoleCapabilities {
  readonly roleName: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  readonly createDatabase: boolean;
  readonly createRole: boolean;
  readonly replication: boolean;
  readonly runtimeMember: boolean;
}

export interface JournalRuntimeRoleOptions {
  readonly bypassRls?: boolean;
  readonly createDatabase?: boolean;
  readonly createRole?: boolean;
  readonly replication?: boolean;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error('Ephemeral journal database identifier is invalid.');
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function randomSuffix(): string {
  return `${process.pid.toString(36)}_${randomBytes(8).toString('hex')}`;
}

function combinedFailure(message: string, failures: readonly unknown[]) {
  return new AggregateError(failures, message);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function databaseUrl(
  baseUrl: string,
  databaseName: string,
  credentials?: { readonly username: string; readonly password: string },
): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${databaseName}`;
  if (credentials !== undefined) {
    parsed.username = credentials.username;
    parsed.password = credentials.password;
  }
  return parsed.toString();
}

export function requireLoopbackJournalAdminUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const serialized = environment[ADMIN_URL_ENVIRONMENT_NAME];
  if (serialized === undefined || serialized.trim().length === 0) {
    throw new Error(
      `${ADMIN_URL_ENVIRONMENT_NAME} is required for the PostgreSQL journal integration suite.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(serialized);
  } catch (error) {
    throw new Error(`${ADMIN_URL_ENVIRONMENT_NAME} must be a valid URL.`, {
      cause: error,
    });
  }
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname.length < 2 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      `${ADMIN_URL_ENVIRONMENT_NAME} must be an authenticated loopback PostgreSQL URL.`,
    );
  }
  return parsed.toString();
}

interface RoleCapabilitiesRow extends QueryResultRow {
  readonly role_name: string;
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly runtime_member: boolean;
}

interface JournalCountsRow extends QueryResultRow {
  readonly intent_count: number;
  readonly outcome_count: number;
}

interface LeaseKeyRow extends QueryResultRow {
  readonly lease_key_id: string;
}

export class EphemeralJournalDatabase {
  readonly databaseName: string;
  readonly #maintenanceUrl: string;
  readonly #maintenancePool: Pool;
  readonly #createdRoles = new Set<string>();
  readonly #services = new Set<V2ExerciseService>();
  #databaseAdminPool: Pool | undefined;
  #runtimeLogin: JournalRuntimeLogin | undefined;
  #databaseCreated = false;
  #closed = false;

  private constructor(maintenanceUrl: string) {
    const suffix = randomSuffix();
    this.databaseName = `wiser_excon_journal_${suffix}`;
    quoteIdentifier(this.databaseName);
    this.#maintenanceUrl = maintenanceUrl;
    this.#maintenancePool = new Pool({
      connectionString: maintenanceUrl,
      application_name: 'wiser-excon-journal-test-maintenance',
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  static async create(
    maintenanceUrl: string,
  ): Promise<EphemeralJournalDatabase> {
    const database = new EphemeralJournalDatabase(maintenanceUrl);
    try {
      await database.#initialize();
      return database;
    } catch (error) {
      try {
        await database.cleanup();
      } catch (cleanupError) {
        throw combinedFailure(
          'Ephemeral journal database setup and cleanup both failed.',
          [error, cleanupError],
        );
      }
      throw error;
    }
  }

  get runtimeLogin(): JournalRuntimeLogin {
    this.#assertOpen();
    if (this.#runtimeLogin === undefined) {
      throw new Error('Ephemeral journal runtime login is unavailable.');
    }
    return this.#runtimeLogin;
  }

  async createRuntimeLogin(
    options: JournalRuntimeRoleOptions = {},
  ): Promise<JournalRuntimeLogin> {
    this.#assertOpen();
    if (!this.#databaseCreated) {
      throw new Error('Ephemeral journal database is unavailable.');
    }
    const roleName = `wiser_excon_test_${randomSuffix()}`;
    const password = randomBytes(32).toString('base64url');
    const quotedRole = quoteIdentifier(roleName);
    await this.#maintenancePool.query(`
      create role ${quotedRole}
        with login nosuperuser
        ${options.createDatabase === true ? 'createdb' : 'nocreatedb'}
        ${options.createRole === true ? 'createrole' : 'nocreaterole'} inherit
        ${options.bypassRls === true ? 'bypassrls' : 'nobypassrls'}
        ${options.replication === true ? 'replication' : 'noreplication'}
        password ${quoteLiteral(password)}
    `);
    this.#createdRoles.add(roleName);
    await this.#maintenancePool.query(
      `grant wiser_excon_runtime to ${quotedRole}`,
    );
    await this.#maintenancePool.query(
      `grant connect on database ${quoteIdentifier(this.databaseName)} to ${quotedRole}`,
    );
    await this.#maintenancePool.query(`
      alter role ${quotedRole} in database ${quoteIdentifier(this.databaseName)}
        set statement_timeout = '30s'
    `);
    await this.#maintenancePool.query(`
      alter role ${quotedRole} in database ${quoteIdentifier(this.databaseName)}
        set idle_in_transaction_session_timeout = '15s'
    `);
    return Object.freeze({
      roleName,
      databaseUrl: databaseUrl(this.#maintenanceUrl, this.databaseName, {
        username: roleName,
        password,
      }),
    });
  }

  async roleCapabilities(
    login: JournalRuntimeLogin = this.runtimeLogin,
  ): Promise<JournalRoleCapabilities> {
    const result = await this.queryAsRuntime<RoleCapabilitiesRow>(
      `
        select role.rolname as role_name, role.rolsuper,
          role.rolbypassrls, role.rolcreatedb, role.rolcreaterole,
          role.rolreplication,
          pg_has_role(current_user, 'wiser_excon_runtime', 'member')
            as runtime_member
        from pg_catalog.pg_roles as role
        where role.rolname = current_user
      `,
      [],
      login,
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new Error('Ephemeral journal runtime role lookup failed.');
    }
    return Object.freeze({
      roleName: row.role_name,
      superuser: row.rolsuper,
      bypassRls: row.rolbypassrls,
      createDatabase: row.rolcreatedb,
      createRole: row.rolcreaterole,
      replication: row.rolreplication,
      runtimeMember: row.runtime_member,
    });
  }

  async journalCounts(): Promise<{
    readonly intents: number;
    readonly outcomes: number;
  }> {
    const result = await this.queryAsRuntime<JournalCountsRow>(`
      select
        (select count(*)::integer
          from excon_private.v2_command_intents) as intent_count,
        (select count(*)::integer
          from excon_private.v2_command_outcomes) as outcome_count
    `);
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new Error('Ephemeral journal count query failed.');
    }
    return Object.freeze({
      intents: Number(row.intent_count),
      outcomes: Number(row.outcome_count),
    });
  }

  async leaseKeyIds(): Promise<readonly string[]> {
    const result = await this.#adminQuery<LeaseKeyRow>(`
      select distinct lease_key_id
      from excon_private.v2_command_intents
      order by lease_key_id
    `);
    return result.rows.map(({ lease_key_id: keyId }) => keyId);
  }

  async revokeOutcomeInsert(): Promise<void> {
    await this.#adminQuery(`
      revoke insert on excon_private.v2_command_outcomes
      from wiser_excon_runtime
    `);
  }

  async grantOutcomeInsert(): Promise<void> {
    await this.#adminQuery(`
      grant insert on excon_private.v2_command_outcomes
      to wiser_excon_runtime
    `);
  }

  async tamperJournalHash(kind: 'intent' | 'outcome'): Promise<void> {
    const target =
      kind === 'intent'
        ? {
            table: 'excon_private.v2_command_intents',
            trigger: 'v2_command_intents_append_only',
            column: 'request_hash',
          }
        : {
            table: 'excon_private.v2_command_outcomes',
            trigger: 'v2_command_outcomes_append_only',
            column: 'result_hash',
          };
    const firstHash = `sha256:${'0'.repeat(64)}`;
    const secondHash = `sha256:${'f'.repeat(64)}`;
    const client = await this.#requiredAdminPool().connect();
    try {
      await client.query('begin');
      await client.query(
        `alter table ${target.table} disable trigger ${target.trigger}`,
      );
      const updated = await client.query(
        `update ${target.table}
          set ${target.column} = case
            when ${target.column} = $1 then $2 else $1
          end`,
        [firstHash, secondHash],
      );
      if (updated.rowCount !== 1) {
        throw new Error('Journal hash fault injection expected one row.');
      }
      await client.query(
        `alter table ${target.table} enable trigger ${target.trigger}`,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async openRuntime(options: {
    readonly keyRing: JournalHmacKeyRing;
    readonly login?: JournalRuntimeLogin;
  }): Promise<V2ExerciseService> {
    this.#assertOpen();
    const runtime = await createV2RuntimeFromEnvironment({
      NODE_ENV: 'test',
      EXCON_V2_MODE: 'postgres',
      EXCON_JOURNAL_DATABASE_URL:
        options.login?.databaseUrl ?? this.runtimeLogin.databaseUrl,
      EXCON_LEASE_HMAC_KEYS: JSON.stringify(options.keyRing),
    });
    this.#services.add(runtime.service);
    return runtime.service;
  }

  async closeService(service: V2ExerciseService): Promise<void> {
    try {
      await service.close();
    } finally {
      this.#services.delete(service);
    }
  }

  async queryAsRuntime<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
    login: JournalRuntimeLogin = this.runtimeLogin,
  ): Promise<QueryResult<Row>> {
    this.#assertOpen();
    const pool = new Pool({
      connectionString: login.databaseUrl,
      application_name: 'wiser-excon-journal-test-inspection',
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    try {
      return await pool.query<Row>(text, [...values]);
    } finally {
      await pool.end();
    }
  }

  async cleanup(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const failures: unknown[] = [];

    for (const service of [...this.#services].reverse()) {
      try {
        await service.close();
      } catch (error) {
        failures.push(error);
      } finally {
        this.#services.delete(service);
      }
    }

    if (this.#databaseAdminPool !== undefined) {
      try {
        await this.#databaseAdminPool.end();
      } catch (error) {
        failures.push(error);
      }
      this.#databaseAdminPool = undefined;
    }

    if (this.#databaseCreated) {
      try {
        await this.#waitForDatabaseConnectionsToClose();
        await this.#maintenancePool.query(
          `drop database ${quoteIdentifier(this.databaseName)}`,
        );
        this.#databaseCreated = false;
      } catch (error) {
        failures.push(error);
      }
    }

    for (const roleName of [...this.#createdRoles].reverse()) {
      try {
        await this.#maintenancePool.query(
          `revoke wiser_excon_runtime from ${quoteIdentifier(roleName)}`,
        );
      } catch (error) {
        failures.push(error);
      }
      try {
        await this.#maintenancePool.query(
          `drop role ${quoteIdentifier(roleName)}`,
        );
        this.#createdRoles.delete(roleName);
      } catch (error) {
        failures.push(error);
      }
    }

    try {
      await this.#maintenancePool.end();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0) {
      throw combinedFailure(
        'Ephemeral journal database cleanup failed.',
        failures,
      );
    }
  }

  async #initialize(): Promise<void> {
    const prerequisites = await this.#maintenancePool.query<{
      readonly role_count: number;
      readonly unsafe_runtime_count: number;
    }>(`
      select
        count(*) filter (
          where rolname in (
            'anon', 'authenticated', 'service_role',
            'wiser_excon_runtime', 'wiser_excon_api'
          )
        )::integer as role_count,
        count(*) filter (
          where rolname in ('wiser_excon_runtime', 'wiser_excon_api')
            and (
              rolsuper or rolbypassrls or rolcreatedb or rolcreaterole
              or rolreplication
            )
        )::integer as unsafe_runtime_count
      from pg_catalog.pg_roles
    `);
    if (
      prerequisites.rows[0]?.role_count !== 5 ||
      prerequisites.rows[0]?.unsafe_runtime_count !== 0
    ) {
      throw new Error(
        'The journal integration suite requires a verified local Supabase role set.',
      );
    }
    await this.#maintenancePool.query(
      `create database ${quoteIdentifier(this.databaseName)} template template0`,
    );
    this.#databaseCreated = true;
    await this.#maintenancePool.query(
      `revoke connect on database ${quoteIdentifier(this.databaseName)} from public`,
    );

    this.#databaseAdminPool = new Pool({
      connectionString: databaseUrl(this.#maintenanceUrl, this.databaseName),
      application_name: 'wiser-excon-journal-test-admin',
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    await this.#adminQuery('create schema excon_private');
    const migration = await readFile(JOURNAL_MIGRATION_URL, 'utf8');
    await this.#adminQuery(migration);
    this.#runtimeLogin = await this.createRuntimeLogin();
  }

  async #waitForDatabaseConnectionsToClose(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await this.#maintenancePool.query<{
        readonly connection_count: number;
      }>(
        `select count(*)::integer as connection_count
         from pg_catalog.pg_stat_activity
         where datname = $1`,
        [this.databaseName],
      );
      if (result.rows[0]?.connection_count === 0) return;
      await wait(20);
    }
    throw new Error(
      'Ephemeral journal database retained an unexpected live connection.',
    );
  }

  async #adminQuery<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return await this.#requiredAdminPool().query<Row>(text, [...values]);
  }

  #requiredAdminPool(): Pool {
    this.#assertOpen();
    if (this.#databaseAdminPool === undefined) {
      throw new Error('Ephemeral journal admin pool is unavailable.');
    }
    return this.#databaseAdminPool;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('Ephemeral journal database is closed.');
    }
  }
}

export async function withEphemeralJournalDatabase<T>(
  maintenanceUrl: string,
  action: (database: EphemeralJournalDatabase) => Promise<T>,
): Promise<T> {
  const database = await EphemeralJournalDatabase.create(maintenanceUrl);
  try {
    return await action(database);
  } finally {
    await database.cleanup();
  }
}
