import { createHash, createHmac, randomUUID } from 'node:crypto';

import { ApiErrorCodeSchema } from '@agent-excon/contracts';
import { DomainError } from '@agent-excon/core';

import { ExerciseServiceError } from './types.js';
import {
  InMemoryV2ExerciseService,
  type InMemoryV2ExerciseServiceOptions,
} from './v2-in-memory-service.js';
import type { V2ExerciseService } from './v2-types.js';

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GENERATED_VALUES = 100_000;
const JOURNAL_VERSION = 1;
const LEASE_TOKEN_ARGUMENT_INDEX = 3;

const WRITER_LOCK_SQL = `
/* v2.journal.writer-lock.acquire */
select pg_try_advisory_lock(1464423250, 2) as acquired
`;

const WRITER_UNLOCK_SQL = `
/* v2.journal.writer-lock.release */
select pg_advisory_unlock(1464423250, 2) as released
`;

const LOAD_JOURNAL_SQL = `
/* v2.journal.load */
select intent.intent_seq, intent.intent_id, intent.command_name,
  intent.journal_version, intent.request_hash, intent.principal, intent.arguments,
  intent.lease_key_id, outcome.outcome_seq, outcome.outcome_status,
  outcome.result_hash, outcome.error_code, outcome.generated_ids,
  outcome.generated_timestamps, outcome.lease_counter_count
from excon_private.v2_command_intents as intent
left join excon_private.v2_command_outcomes as outcome
  on outcome.intent_id = intent.intent_id
order by intent.intent_seq
`;

const INSERT_INTENT_SQL = `
/* v2.journal.intent.insert */
insert into excon_private.v2_command_intents (
  intent_id, command_name, journal_version, request_hash, principal, arguments,
  lease_key_id
) values ($1::uuid, $2, $3::smallint, $4, $5::jsonb, $6::jsonb, $7)
returning intent_seq
`;

const INSERT_OUTCOME_SQL = `
/* v2.journal.outcome.insert */
insert into excon_private.v2_command_outcomes (
  intent_id, outcome_status, result_hash, error_code, generated_ids,
  generated_timestamps, lease_counter_count
) values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::integer)
returning outcome_seq
`;

export const V2_JOURNALED_MUTATIONS = Object.freeze([
  'createScenario',
  'createScenarioVersion',
  'validateScenarioVersion',
  'publishScenarioVersion',
  'createAgent',
  'createAgentVersion',
  'createRun',
  'joinRun',
  'startRun',
  'sync',
  'claimTask',
  'beginTask',
  'heartbeatTask',
  'releaseTask',
  'submitTask',
  'createMessage',
  'createArtifact',
  'createArtifactVersion',
  'endorseSubmission',
] as const satisfies readonly (keyof V2ExerciseService)[]);

type JournaledMutation = (typeof V2_JOURNALED_MUTATIONS)[number];
const MUTATION_NAMES: ReadonlySet<string> = new Set(V2_JOURNALED_MUTATIONS);
const LEASE_TOKEN_MUTATIONS: ReadonlySet<JournaledMutation> = new Set([
  'beginTask',
  'heartbeatTask',
  'releaseTask',
  'submitTask',
]);

export interface V2JournalQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount?: number | null;
}

export interface V2JournalClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<V2JournalQueryResult>;
  release(): void;
}

export interface V2JournalPool {
  connect(): Promise<V2JournalClient>;
  end(): Promise<void>;
}

export type V2JournalErrorCode =
  | 'JOURNAL_INVALID_CONFIGURATION'
  | 'JOURNAL_WRITER_LOCKED'
  | 'JOURNAL_UNAVAILABLE'
  | 'JOURNAL_CORRUPT'
  | 'JOURNAL_REPLAY_DRIFT'
  | 'JOURNAL_UNREADY'
  | 'JOURNAL_SECRET_REFERENCE_UNKNOWN';

const ERROR_MESSAGES: Readonly<Record<V2JournalErrorCode, string>> = {
  JOURNAL_INVALID_CONFIGURATION: 'V2 journal configuration is invalid.',
  JOURNAL_WRITER_LOCKED: 'Another V2 API writer owns the journal lock.',
  JOURNAL_UNAVAILABLE: 'The V2 command journal is unavailable.',
  JOURNAL_CORRUPT: 'The V2 command journal is corrupt.',
  JOURNAL_REPLAY_DRIFT: 'V2 command replay produced a different outcome.',
  JOURNAL_UNREADY: 'The V2 journal service is not ready.',
  JOURNAL_SECRET_REFERENCE_UNKNOWN:
    'A journaled secret reference cannot be resolved safely.',
};

export class V2JournalError extends Error {
  constructor(readonly code: V2JournalErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'V2JournalError';
  }
}

export interface PostgresV2JournalServiceOptions extends Pick<
  InMemoryV2ExerciseServiceOptions,
  'idFactory' | 'now'
> {
  readonly pool: V2JournalPool;
  readonly intentIdFactory?: () => string;
  readonly activeLeaseHmacKeyId: string;
  readonly leaseHmacKeys: Readonly<Record<string, string>>;
}

export type PostgresV2JournalService = V2ExerciseService;

interface PrincipalProjection {
  readonly id: string;
  readonly participantVersionIds: readonly string[];
  readonly roles?: readonly ('operator' | 'run_agent')[];
  readonly runAgentIds?: readonly string[];
}

interface SecretReference {
  readonly $secretRef: {
    readonly kind: 'lease-token-hash';
    readonly tokenHash: string;
  };
}

interface JournalIntent {
  readonly sequence: number;
  readonly intentId: string;
  readonly commandName: JournaledMutation;
  readonly journalVersion: number;
  readonly requestHash: string;
  readonly principal: PrincipalProjection;
  readonly arguments: readonly unknown[];
  readonly leaseKeyId: string;
}

interface GeneratedValues {
  readonly ids: readonly string[];
  readonly timestamps: readonly string[];
  readonly leaseCounterCount: number;
}

interface JournalOutcome extends GeneratedValues {
  readonly sequence: number;
  readonly status: 'succeeded' | 'rejected';
  readonly resultHash: string;
  readonly errorCode?: string;
}

interface JournalEntry {
  readonly intent: JournalIntent;
  readonly outcome?: JournalOutcome;
}

interface SuccessfulExecution {
  readonly status: 'succeeded';
  readonly result: unknown;
  readonly resultHash: string;
  readonly generated: GeneratedValues;
}

interface RejectedExecution {
  readonly status: 'rejected';
  readonly error: ExerciseServiceError;
  readonly resultHash: string;
  readonly generated: GeneratedValues;
}

type CommandExecution = SuccessfulExecution | RejectedExecution;

function journalError(code: V2JournalErrorCode) {
  return new V2JournalError(code);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function digest(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw journalError('JOURNAL_CORRUPT');
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw journalError('JOURNAL_CORRUPT');
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw journalError('JOURNAL_CORRUPT');
  }
}

function text(value: Readonly<Record<string, unknown>>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') throw journalError('JOURNAL_CORRUPT');
  return field;
}

function integer(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const field = Number(value[key]);
  if (!Number.isSafeInteger(field)) throw journalError('JOURNAL_CORRUPT');
  return field;
}

function optionalText(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const field = value[key];
  if (field === null || field === undefined) return undefined;
  if (typeof field !== 'string') throw journalError('JOURNAL_CORRUPT');
  return field;
}

function boolean(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const field = value[key];
  if (typeof field !== 'boolean') throw journalError('JOURNAL_CORRUPT');
  return field;
}

function stringArray(value: unknown): readonly string[] {
  const parsed = jsonValue(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_GENERATED_VALUES ||
    parsed.some((entry) => typeof entry !== 'string')
  ) {
    throw journalError('JOURNAL_CORRUPT');
  }
  return parsed as readonly string[];
}

function principal(value: unknown): PrincipalProjection {
  const candidate = record(jsonValue(value));
  const id = text(candidate, 'id');
  const participantVersionIds = stringArray(candidate['participantVersionIds']);
  const rolesValue = candidate['roles'];
  const roles =
    rolesValue === undefined
      ? undefined
      : stringArray(rolesValue).map((role) => {
          if (role !== 'operator' && role !== 'run_agent') {
            throw journalError('JOURNAL_CORRUPT');
          }
          return role;
        });
  const runAgentIdsValue = candidate['runAgentIds'];
  const runAgentIds =
    runAgentIdsValue === undefined ? undefined : stringArray(runAgentIdsValue);
  return {
    id,
    participantVersionIds,
    ...(roles === undefined ? {} : { roles }),
    ...(runAgentIds === undefined ? {} : { runAgentIds }),
  };
}

function projectPrincipal(value: unknown): PrincipalProjection {
  const candidate = record(value);
  return principal({
    id: candidate['id'],
    participantVersionIds: candidate['participantVersionIds'],
    ...(candidate['roles'] === undefined ? {} : { roles: candidate['roles'] }),
    ...(candidate['runAgentIds'] === undefined
      ? {}
      : { runAgentIds: candidate['runAgentIds'] }),
  });
}

class GenerationTape {
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  readonly #keys: ReadonlyMap<string, string>;
  readonly #knownLeaseTokens: Map<string, string>;
  #active:
    | {
        readonly mode: 'live';
        readonly intentId: string;
        readonly leaseKeyId: string;
        readonly ids: string[];
        readonly timestamps: string[];
        leaseIndex: number;
      }
    | {
        readonly mode: 'replay';
        readonly intentId: string;
        readonly leaseKeyId: string;
        readonly ids: readonly string[];
        readonly timestamps: readonly string[];
        readonly expectedLeaseCount: number;
        idIndex: number;
        timestampIndex: number;
        leaseIndex: number;
      }
    | undefined;

  constructor(options: {
    readonly idFactory: () => string;
    readonly now: () => Date;
    readonly keys: ReadonlyMap<string, string>;
    readonly knownLeaseTokens: Map<string, string>;
  }) {
    this.#idFactory = options.idFactory;
    this.#now = options.now;
    this.#keys = options.keys;
    this.#knownLeaseTokens = options.knownLeaseTokens;
  }

  readonly idFactory = (): string => {
    const active = this.#required();
    if (active.mode === 'replay') {
      const value = active.ids[active.idIndex];
      if (value === undefined) throw journalError('JOURNAL_REPLAY_DRIFT');
      active.idIndex += 1;
      return value;
    }
    const value = this.#idFactory();
    if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    if (active.ids.length >= MAX_GENERATED_VALUES) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    active.ids.push(value);
    return value;
  };

  readonly now = (): Date => {
    const active = this.#required();
    if (active.mode === 'replay') {
      const value = active.timestamps[active.timestampIndex];
      if (value === undefined) throw journalError('JOURNAL_REPLAY_DRIFT');
      active.timestampIndex += 1;
      return new Date(value);
    }
    const value = this.#now();
    if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    if (active.timestamps.length >= MAX_GENERATED_VALUES) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    active.timestamps.push(value.toISOString());
    return new Date(value.valueOf());
  };

  readonly leaseTokenFactory = (): string => {
    const active = this.#required();
    const key = this.#keys.get(active.leaseKeyId);
    if (key === undefined) throw journalError('JOURNAL_CORRUPT');
    if (
      active.mode === 'replay' &&
      active.leaseIndex >= active.expectedLeaseCount
    ) {
      throw journalError('JOURNAL_REPLAY_DRIFT');
    }
    const token = `wlt_${createHmac('sha256', key)
      .update(`${active.intentId}:${active.leaseIndex}`)
      .digest('base64url')}`;
    active.leaseIndex += 1;
    this.#knownLeaseTokens.set(digest(token), token);
    return token;
  };

  startLive(intentId: string, leaseKeyId: string): void {
    if (this.#active !== undefined) throw journalError('JOURNAL_CORRUPT');
    this.#active = {
      mode: 'live',
      intentId,
      leaseKeyId,
      ids: [],
      timestamps: [],
      leaseIndex: 0,
    };
  }

  startReplay(
    intentId: string,
    leaseKeyId: string,
    generated: GeneratedValues,
  ): void {
    if (this.#active !== undefined) throw journalError('JOURNAL_CORRUPT');
    this.#active = {
      mode: 'replay',
      intentId,
      leaseKeyId,
      ids: generated.ids,
      timestamps: generated.timestamps,
      expectedLeaseCount: generated.leaseCounterCount,
      idIndex: 0,
      timestampIndex: 0,
      leaseIndex: 0,
    };
  }

  finish(): GeneratedValues {
    const active = this.#required();
    this.#active = undefined;
    if (
      active.mode === 'replay' &&
      (active.idIndex !== active.ids.length ||
        active.timestampIndex !== active.timestamps.length ||
        active.leaseIndex !== active.expectedLeaseCount)
    ) {
      throw journalError('JOURNAL_REPLAY_DRIFT');
    }
    return {
      ids: [...active.ids],
      timestamps: [...active.timestamps],
      leaseCounterCount: active.leaseIndex,
    };
  }

  abort(): void {
    this.#active = undefined;
  }

  hasKey(keyId: string): boolean {
    return this.#keys.has(keyId);
  }

  #required() {
    if (this.#active === undefined) throw journalError('JOURNAL_UNREADY');
    return this.#active;
  }
}

function isSecretReference(value: unknown): value is SecretReference {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const reference = (value as Readonly<Record<string, unknown>>)['$secretRef'];
  const fields =
    reference !== null && typeof reference === 'object'
      ? (reference as Readonly<Record<string, unknown>>)
      : undefined;
  return (
    fields !== undefined &&
    !Array.isArray(reference) &&
    fields['kind'] === 'lease-token-hash' &&
    typeof fields['tokenHash'] === 'string'
  );
}

function copyArguments(value: readonly unknown[]): readonly unknown[] {
  const copied = canonicalize(value);
  if (!Array.isArray(copied)) throw journalError('JOURNAL_CORRUPT');
  return copied;
}

function sealCommandArguments(
  commandName: JournaledMutation,
  value: readonly unknown[],
  knownLeaseTokens: ReadonlyMap<string, string>,
): readonly unknown[] {
  const result = [...copyArguments(value)];
  if (!LEASE_TOKEN_MUTATIONS.has(commandName)) return result;
  const input = record(result[LEASE_TOKEN_ARGUMENT_INDEX]);
  const leaseToken = input['leaseToken'];
  if (typeof leaseToken !== 'string') {
    throw journalError('JOURNAL_SECRET_REFERENCE_UNKNOWN');
  }
  const tokenHash = digest(leaseToken);
  if (knownLeaseTokens.get(tokenHash) !== leaseToken) {
    throw journalError('JOURNAL_SECRET_REFERENCE_UNKNOWN');
  }
  result[LEASE_TOKEN_ARGUMENT_INDEX] = {
    ...input,
    leaseToken: {
      $secretRef: { kind: 'lease-token-hash', tokenHash },
    } satisfies SecretReference,
  };
  return result;
}

function unsealCommandArguments(
  commandName: JournaledMutation,
  value: readonly unknown[],
  knownLeaseTokens: ReadonlyMap<string, string>,
): readonly unknown[] {
  const result = [...copyArguments(value)];
  if (!LEASE_TOKEN_MUTATIONS.has(commandName)) return result;
  const input = record(result[LEASE_TOKEN_ARGUMENT_INDEX]);
  const reference = input['leaseToken'];
  if (!isSecretReference(reference)) {
    throw journalError('JOURNAL_CORRUPT');
  }
  const tokenHash = reference.$secretRef.tokenHash;
  if (!HASH_PATTERN.test(tokenHash)) throw journalError('JOURNAL_CORRUPT');
  const token = knownLeaseTokens.get(tokenHash);
  if (token === undefined) {
    throw journalError('JOURNAL_SECRET_REFERENCE_UNKNOWN');
  }
  result[LEASE_TOKEN_ARGUMENT_INDEX] = { ...input, leaseToken: token };
  return result;
}

function errorEnvelope(error: ExerciseServiceError) {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    details: error.details ?? null,
  };
}

function normalizeDomainError(
  error: unknown,
): ExerciseServiceError | undefined {
  if (error instanceof ExerciseServiceError) return error;
  if (!(error instanceof DomainError)) return undefined;
  const parsedCode = ApiErrorCodeSchema.safeParse(error.code);
  return new ExerciseServiceError(
    parsedCode.success ? parsedCode.data : 'VALIDATION_FAILED',
    error.message,
  );
}

function intentEnvelope(
  intent: Pick<
    JournalIntent,
    | 'intentId'
    | 'commandName'
    | 'journalVersion'
    | 'principal'
    | 'arguments'
    | 'leaseKeyId'
  >,
) {
  return {
    journalVersion: intent.journalVersion,
    intentId: intent.intentId,
    command: {
      name: intent.commandName,
      version: intent.journalVersion,
    },
    principal: intent.principal,
    arguments: intent.arguments,
    lease: { hmacKeyId: intent.leaseKeyId },
    generationTapeStart: {
      idIndex: 0,
      timestampIndex: 0,
      leaseIndex: 0,
    },
  };
}

function outcomeEnvelope(
  execution:
    | Pick<SuccessfulExecution, 'status' | 'result' | 'generated'>
    | Pick<RejectedExecution, 'status' | 'error' | 'generated'>,
) {
  return {
    journalVersion: JOURNAL_VERSION,
    status: execution.status,
    result: execution.status === 'succeeded' ? execution.result : null,
    error:
      execution.status === 'rejected' ? errorEnvelope(execution.error) : null,
    generated: {
      ids: execution.generated.ids,
      timestamps: execution.generated.timestamps,
      leaseCounterCount: execution.generated.leaseCounterCount,
    },
  };
}

function mutationName(value: string): JournaledMutation {
  if (!MUTATION_NAMES.has(value)) throw journalError('JOURNAL_CORRUPT');
  return value as JournaledMutation;
}

function parseEntry(row: Readonly<Record<string, unknown>>): JournalEntry {
  const intentId = text(row, 'intent_id');
  const requestHash = text(row, 'request_hash');
  const leaseKeyId = text(row, 'lease_key_id');
  const journalVersion = integer(row, 'journal_version');
  if (
    !UUID_PATTERN.test(intentId) ||
    !HASH_PATTERN.test(requestHash) ||
    !KEY_ID_PATTERN.test(leaseKeyId) ||
    journalVersion !== JOURNAL_VERSION
  ) {
    throw journalError('JOURNAL_CORRUPT');
  }
  const argumentsValue = jsonValue(row['arguments']);
  if (!Array.isArray(argumentsValue)) throw journalError('JOURNAL_CORRUPT');
  const intent: JournalIntent = {
    sequence: integer(row, 'intent_seq'),
    intentId,
    commandName: mutationName(text(row, 'command_name')),
    journalVersion,
    requestHash,
    principal: principal(row['principal']),
    arguments: argumentsValue,
    leaseKeyId,
  };
  const expectedHash = digest(intentEnvelope(intent));
  if (expectedHash !== intent.requestHash) {
    throw journalError('JOURNAL_CORRUPT');
  }
  if (row['outcome_seq'] === null || row['outcome_seq'] === undefined) {
    return { intent };
  }
  const status = text(row, 'outcome_status');
  const resultHash = text(row, 'result_hash');
  if (
    (status !== 'succeeded' && status !== 'rejected') ||
    !HASH_PATTERN.test(resultHash)
  ) {
    throw journalError('JOURNAL_CORRUPT');
  }
  const errorCode = optionalText(row, 'error_code');
  if (
    (status === 'succeeded' && errorCode !== undefined) ||
    (status === 'rejected' && errorCode === undefined)
  ) {
    throw journalError('JOURNAL_CORRUPT');
  }
  return {
    intent,
    outcome: {
      sequence: integer(row, 'outcome_seq'),
      status,
      resultHash,
      ...(errorCode === undefined ? {} : { errorCode }),
      ids: stringArray(row['generated_ids']),
      timestamps: stringArray(row['generated_timestamps']),
      leaseCounterCount: integer(row, 'lease_counter_count'),
    },
  };
}

class V2JournalRuntime {
  readonly #pool: V2JournalPool;
  readonly #client: V2JournalClient;
  readonly #inner: InMemoryV2ExerciseService;
  readonly #intentIdFactory: () => string;
  readonly #activeLeaseKeyId: string;
  readonly #knownLeaseTokens = new Map<string, string>();
  readonly #tape: GenerationTape;
  readonly #service: PostgresV2JournalService;
  #ready = false;
  #closed = false;
  #tail: Promise<void> = Promise.resolve();

  private constructor(options: {
    readonly pool: V2JournalPool;
    readonly client: V2JournalClient;
    readonly intentIdFactory: () => string;
    readonly activeLeaseKeyId: string;
    readonly keys: ReadonlyMap<string, string>;
    readonly idFactory: () => string;
    readonly now: () => Date;
  }) {
    this.#pool = options.pool;
    this.#client = options.client;
    this.#intentIdFactory = options.intentIdFactory;
    this.#activeLeaseKeyId = options.activeLeaseKeyId;
    this.#tape = new GenerationTape({
      idFactory: options.idFactory,
      now: options.now,
      keys: options.keys,
      knownLeaseTokens: this.#knownLeaseTokens,
    });
    this.#inner = new InMemoryV2ExerciseService({
      idFactory: this.#tape.idFactory,
      now: this.#tape.now,
      leaseTokenFactory: this.#tape.leaseTokenFactory,
    });
    this.#service = this.#proxy();
  }

  static async create(
    options: PostgresV2JournalServiceOptions,
  ): Promise<PostgresV2JournalService> {
    if (
      options.pool === null ||
      typeof options.pool?.connect !== 'function' ||
      typeof options.pool.end !== 'function' ||
      (typeof options.idFactory !== 'function' &&
        options.idFactory !== undefined) ||
      (typeof options.now !== 'function' && options.now !== undefined) ||
      (typeof options.intentIdFactory !== 'function' &&
        options.intentIdFactory !== undefined) ||
      !KEY_ID_PATTERN.test(options.activeLeaseHmacKeyId)
    ) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    const keys = new Map<string, string>();
    for (const [keyId, key] of Object.entries(options.leaseHmacKeys)) {
      if (!KEY_ID_PATTERN.test(keyId) || key.length < 32 || key.length > 4096) {
        throw journalError('JOURNAL_INVALID_CONFIGURATION');
      }
      keys.set(keyId, key);
    }
    if (!keys.has(options.activeLeaseHmacKeyId)) {
      throw journalError('JOURNAL_INVALID_CONFIGURATION');
    }
    let client: V2JournalClient;
    try {
      client = await options.pool.connect();
    } catch {
      await options.pool.end().catch(() => undefined);
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    const runtime = new V2JournalRuntime({
      pool: options.pool,
      client,
      intentIdFactory: options.intentIdFactory ?? randomUUID,
      activeLeaseKeyId: options.activeLeaseHmacKeyId,
      keys,
      idFactory: options.idFactory ?? randomUUID,
      now: options.now ?? (() => new Date()),
    });
    try {
      await runtime.#acquireWriter();
      await runtime.#recover();
      runtime.#ready = true;
      return runtime.#service;
    } catch (error) {
      await runtime.#inner.close().catch(() => undefined);
      await runtime.#dispose().catch(() => undefined);
      if (error instanceof V2JournalError) throw error;
      throw journalError('JOURNAL_UNAVAILABLE');
    }
  }

  #proxy(): PostgresV2JournalService {
    return new Proxy(this.#inner, {
      get: (target, property, receiver) => {
        if (property === 'isReady') {
          return () => this.#isReady();
        }
        if (property === 'close') {
          return () => this.#close();
        }
        const member = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || typeof member !== 'function') {
          return member;
        }
        if (MUTATION_NAMES.has(property)) {
          return (...arguments_: readonly unknown[]) =>
            this.#mutate(mutationName(property), arguments_);
        }
        return (...arguments_: readonly unknown[]) =>
          this.#query(property, arguments_);
      },
    });
  }

  #isReady(): Promise<boolean> {
    if (!this.#ready || this.#closed) return Promise.resolve(false);
    return this.#inner.isReady();
  }

  #query(methodName: string, arguments_: readonly unknown[]): Promise<unknown> {
    return this.#serialize(async () => {
      this.#assertReady();
      return await this.#invoke(methodName, arguments_);
    });
  }

  #mutate(
    commandName: JournaledMutation,
    arguments_: readonly unknown[],
  ): Promise<unknown> {
    return this.#serialize(async () => {
      this.#assertReady();
      const principalValue = projectPrincipal(arguments_[0]);
      const commandArguments = arguments_.slice(1);
      const sealedArguments = sealCommandArguments(
        commandName,
        commandArguments,
        this.#knownLeaseTokens,
      );
      const intentId = this.#intentIdFactory();
      if (!UUID_PATTERN.test(intentId)) {
        throw journalError('JOURNAL_INVALID_CONFIGURATION');
      }
      const envelope = {
        intentId,
        commandName,
        journalVersion: JOURNAL_VERSION,
        principal: principalValue,
        arguments: sealedArguments,
        leaseKeyId: this.#activeLeaseKeyId,
      };
      const intent: JournalIntent = {
        sequence: 0,
        ...envelope,
        requestHash: digest(intentEnvelope(envelope)),
      };
      try {
        await this.#appendIntent(intent);
      } catch (error) {
        this.#ready = false;
        if (error instanceof V2JournalError) throw error;
        throw journalError('JOURNAL_UNAVAILABLE');
      }
      let execution: CommandExecution;
      try {
        execution = await this.#execute(intent, [
          principalValue,
          ...commandArguments,
        ]);
      } catch {
        this.#tape.abort();
        this.#ready = false;
        throw journalError('JOURNAL_UNAVAILABLE');
      }
      try {
        await this.#appendOutcome(intent.intentId, execution);
      } catch {
        this.#ready = false;
        throw journalError('JOURNAL_UNAVAILABLE');
      }
      if (execution.status === 'rejected') throw execution.error;
      return execution.result;
    });
  }

  async #execute(
    intent: JournalIntent,
    arguments_: readonly unknown[],
    expected?: JournalOutcome,
  ): Promise<CommandExecution> {
    if (expected === undefined) {
      this.#tape.startLive(intent.intentId, intent.leaseKeyId);
    } else {
      this.#tape.startReplay(intent.intentId, intent.leaseKeyId, expected);
    }
    try {
      try {
        const result = await this.#invoke(intent.commandName, arguments_);
        const generated = this.#tape.finish();
        const envelope = { status: 'succeeded' as const, result, generated };
        return {
          ...envelope,
          resultHash: digest(outcomeEnvelope(envelope)),
        };
      } catch (error) {
        const domainError = normalizeDomainError(error);
        if (domainError === undefined) throw error;
        const generated = this.#tape.finish();
        const envelope = {
          status: 'rejected' as const,
          error: domainError,
          generated,
        };
        return {
          ...envelope,
          resultHash: digest(outcomeEnvelope(envelope)),
        };
      }
    } catch (error) {
      this.#tape.abort();
      throw error;
    }
  }

  async #invoke(
    methodName: string,
    arguments_: readonly unknown[],
  ): Promise<unknown> {
    const method = Reflect.get(this.#inner, methodName) as unknown;
    if (typeof method !== 'function') throw journalError('JOURNAL_CORRUPT');
    const result = Reflect.apply(method, this.#inner, arguments_) as unknown;
    return await Promise.resolve(result);
  }

  async #acquireWriter(): Promise<void> {
    let result: V2JournalQueryResult;
    try {
      result = await this.#client.query(WRITER_LOCK_SQL);
    } catch {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    const row = this.#singleRow(result);
    if (!boolean(row, 'acquired')) {
      throw journalError('JOURNAL_WRITER_LOCKED');
    }
  }

  async #recover(): Promise<void> {
    let result: V2JournalQueryResult;
    try {
      result = await this.#client.query(LOAD_JOURNAL_SQL);
    } catch {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    if (this.#rowCount(result) !== result.rows.length) {
      throw journalError('JOURNAL_CORRUPT');
    }
    const entries = result.rows.map(parseEntry);
    let previousSequence = 0;
    for (const entry of entries) {
      if (entry.intent.sequence <= previousSequence) {
        throw journalError('JOURNAL_CORRUPT');
      }
      previousSequence = entry.intent.sequence;
      if (!this.#hasLeaseKey(entry.intent.leaseKeyId)) {
        throw journalError('JOURNAL_CORRUPT');
      }
      const unsealed = unsealCommandArguments(
        entry.intent.commandName,
        entry.intent.arguments,
        this.#knownLeaseTokens,
      );
      const arguments_ = [entry.intent.principal, ...unsealed];
      if (entry.outcome === undefined) {
        const recovered = await this.#execute(entry.intent, arguments_);
        await this.#appendOutcome(entry.intent.intentId, recovered);
        continue;
      }
      const replayed = await this.#execute(
        entry.intent,
        arguments_,
        entry.outcome,
      );
      if (
        replayed.status !== entry.outcome.status ||
        replayed.resultHash !== entry.outcome.resultHash ||
        (replayed.status === 'rejected' &&
          replayed.error.code !== entry.outcome.errorCode)
      ) {
        throw journalError('JOURNAL_REPLAY_DRIFT');
      }
    }
  }

  async #appendIntent(intent: JournalIntent): Promise<void> {
    let result: V2JournalQueryResult;
    try {
      result = await this.#client.query(INSERT_INTENT_SQL, [
        intent.intentId,
        intent.commandName,
        intent.journalVersion,
        intent.requestHash,
        JSON.stringify(intent.principal),
        JSON.stringify(intent.arguments),
        intent.leaseKeyId,
      ]);
    } catch {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    const row = this.#singleRow(result);
    if (integer(row, 'intent_seq') < 1) {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
  }

  async #appendOutcome(
    intentId: string,
    execution: CommandExecution,
  ): Promise<void> {
    let result: V2JournalQueryResult;
    try {
      result = await this.#client.query(INSERT_OUTCOME_SQL, [
        intentId,
        execution.status,
        execution.resultHash,
        execution.status === 'rejected' ? execution.error.code : null,
        JSON.stringify(execution.generated.ids),
        JSON.stringify(execution.generated.timestamps),
        execution.generated.leaseCounterCount,
      ]);
    } catch {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    const row = this.#singleRow(result);
    if (integer(row, 'outcome_seq') < 1) {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
  }

  #hasLeaseKey(keyId: string): boolean {
    return this.#tape.hasKey(keyId);
  }

  #singleRow(result: V2JournalQueryResult): Readonly<Record<string, unknown>> {
    if (this.#rowCount(result) !== 1 || result.rows.length !== 1) {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    return result.rows[0]!;
  }

  #rowCount(result: V2JournalQueryResult): number {
    if (
      result.rowCount === null ||
      result.rowCount === undefined ||
      !Number.isSafeInteger(result.rowCount) ||
      result.rowCount < 0
    ) {
      throw journalError('JOURNAL_UNAVAILABLE');
    }
    return result.rowCount;
  }

  #assertReady(): void {
    if (!this.#ready || this.#closed) throw journalError('JOURNAL_UNREADY');
  }

  #serialize<T>(action: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(action, action);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #close(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#closed) return;
      this.#ready = false;
      this.#closed = true;
      let failed = false;
      try {
        await this.#inner.close();
      } catch {
        failed = true;
      }
      try {
        await this.#dispose();
      } catch {
        failed = true;
      }
      if (failed) throw journalError('JOURNAL_UNAVAILABLE');
    });
  }

  async #dispose(): Promise<void> {
    let failed = false;
    try {
      const result = await this.#client.query(WRITER_UNLOCK_SQL);
      const row = this.#singleRow(result);
      if (!boolean(row, 'released')) failed = true;
    } catch {
      failed = true;
    }
    try {
      this.#client.release();
    } catch {
      failed = true;
    }
    try {
      await this.#pool.end();
    } catch {
      failed = true;
    }
    if (failed) throw journalError('JOURNAL_UNAVAILABLE');
  }
}

export function createPostgresV2JournalService(
  options: PostgresV2JournalServiceOptions,
): Promise<PostgresV2JournalService> {
  return V2JournalRuntime.create(options);
}
