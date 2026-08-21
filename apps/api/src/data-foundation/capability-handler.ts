import { createHash } from 'node:crypto';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
  type SecurityLevel,
} from '@wiser/data-contracts';
import {
  PlatformRequestContextSchema,
  type AuthorizedContext,
  type PlatformPrincipal,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

export type DataCapabilityHandlerErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'NOT_AUTHENTICATED'
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'SECURITY_LEVEL_EXCEEDED'
  | 'CAPABILITY_TIMEOUT'
  | 'EXECUTION_FAILED'
  | 'IMPLEMENTATION_CONTRACT_VIOLATION'
  | 'AUDIT_FAILED';

const ERROR_MESSAGES: Readonly<Record<DataCapabilityHandlerErrorCode, string>> =
  {
    INVALID_CONFIGURATION:
      '数据能力运行时配置无效。 / Data Capability runtime configuration is invalid.',
    NOT_AUTHENTICATED:
      '需要有效的 WISER 身份。 / A valid WISER identity is required.',
    VALIDATION_FAILED:
      '数据能力输入未通过校验。 / The Data Capability input failed validation.',
    FORBIDDEN:
      '当前身份无权执行该数据能力。 / The current identity cannot execute this data capability.',
    NOT_FOUND:
      '请求的数据资源不存在。 / The requested data resource was not found.',
    CONFLICT:
      '数据资源状态或版本已变化。 / The data resource state or version changed.',
    IDEMPOTENCY_KEY_REQUIRED:
      '该写操作需要 UUID Idempotency-Key。 / This command requires a UUID Idempotency-Key.',
    SECURITY_LEVEL_EXCEEDED:
      '请求的数据安全等级超过当前授权上限。 / The requested data security level exceeds the authorization ceiling.',
    CAPABILITY_TIMEOUT: '数据能力执行超时。 / The Data Capability timed out.',
    EXECUTION_FAILED:
      '数据能力暂时无法完成。 / The Data Capability could not be completed.',
    IMPLEMENTATION_CONTRACT_VIOLATION:
      '数据能力实现返回了无效结果。 / The Data Capability implementation returned an invalid result.',
    AUDIT_FAILED:
      '数据能力审计写入失败。 / The Data Capability audit write failed.',
  };

const SECURITY_RANK: Readonly<Record<SecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DataCapabilityHandlerError extends Error {
  constructor(readonly code: DataCapabilityHandlerErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DataCapabilityHandlerError';
  }
}

export interface DataCapabilityExecutionContext {
  readonly principal: PlatformPrincipal;
  readonly authorization: AuthorizedContext;
  readonly effectiveMaxSecurityLevel: SecurityLevel;
  readonly traceId: string;
  readonly idempotencyKey?: string;
  readonly auditLevel: 'STANDARD' | 'DETAILED' | 'FULL';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface DataCapabilityExecutor {
  readonly id: DataCapabilityId;
  readonly execute: (
    input: unknown,
    context: DataCapabilityExecutionContext,
  ) => Promise<unknown>;
}

export interface DataCapabilityAuditRecord {
  readonly capabilityId: DataCapabilityId;
  readonly actorId: string;
  readonly actorType: PlatformPrincipal['actorType'];
  readonly delegatedBy?: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly traceId: string;
  readonly auditLevel: 'STANDARD' | 'DETAILED' | 'FULL';
  readonly decision: 'SUCCEEDED' | 'DENIED' | 'FAILED';
  readonly errorCode?: DataCapabilityHandlerErrorCode;
  readonly inputHash: string;
  readonly outputHash?: string;
  readonly occurredAt: string;
}

export interface DataCapabilityAuditPort {
  record(record: DataCapabilityAuditRecord): Promise<void>;
}

export interface DataCapabilityHandlerOptions {
  readonly executors: readonly DataCapabilityExecutor[];
  readonly audit: DataCapabilityAuditPort;
  readonly now?: () => Date;
}

export interface ExecuteDataCapabilityInput {
  readonly capabilityId: DataCapabilityId;
  readonly input: unknown;
  readonly requestContext: PlatformRequestContext;
  readonly idempotencyKey?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite JSON number.');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  throw new TypeError('Unsupported JSON value.');
}

function safeHash(value: unknown): string {
  let canonical: string;
  try {
    canonical = canonicalJson(value);
  } catch {
    canonical = '"invalid-json-value"';
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function minimumSecurityLevel(
  left: SecurityLevel,
  right: SecurityLevel,
): SecurityLevel {
  return SECURITY_RANK[left] <= SECURITY_RANK[right] ? left : right;
}

function requestedSecurityLevels(value: unknown): readonly SecurityLevel[] {
  const levels: SecurityLevel[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8 || candidate === null || typeof candidate !== 'object') {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(
      candidate as Readonly<Record<string, unknown>>,
    )) {
      if (
        (key === 'securityLevel' || key === 'requestedSecurityLevel') &&
        typeof entry === 'string' &&
        Object.hasOwn(SECURITY_RANK, entry)
      ) {
        levels.push(entry as SecurityLevel);
      } else if (key === 'securityLevels' && Array.isArray(entry)) {
        for (const level of entry) {
          if (
            typeof level === 'string' &&
            Object.hasOwn(SECURITY_RANK, level)
          ) {
            levels.push(level as SecurityLevel);
          }
        }
      } else {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
  return levels;
}

function error(code: DataCapabilityHandlerErrorCode) {
  return new DataCapabilityHandlerError(code);
}

function translatedExecutorError(caught: unknown): DataCapabilityHandlerError {
  if (caught instanceof DataCapabilityHandlerError) return caught;
  if (caught !== null && typeof caught === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(caught, 'statusCode');
    const status: unknown = descriptor?.value;
    if (status === 400 || status === 422) return error('VALIDATION_FAILED');
    if (status === 403) return error('FORBIDDEN');
    if (status === 404) return error('NOT_FOUND');
    if (status === 409) return error('CONFLICT');
  }
  return error('EXECUTION_FAILED');
}

export class DataCapabilityHandler {
  readonly #executors: ReadonlyMap<DataCapabilityId, DataCapabilityExecutor>;
  readonly #audit: DataCapabilityAuditPort;
  readonly #now: () => Date;

  constructor(options: DataCapabilityHandlerOptions) {
    if (
      options.audit === null ||
      typeof options.audit?.record !== 'function' ||
      (options.now !== undefined && typeof options.now !== 'function')
    ) {
      throw error('INVALID_CONFIGURATION');
    }
    const executors = new Map<DataCapabilityId, DataCapabilityExecutor>();
    for (const executor of options.executors) {
      if (executors.has(executor.id)) {
        throw new Error(`Duplicate Data Capability executor: ${executor.id}.`);
      }
      if (
        !DATA_CAPABILITY_IDS.includes(executor.id) ||
        typeof executor.execute !== 'function'
      ) {
        throw error('INVALID_CONFIGURATION');
      }
      executors.set(executor.id, executor);
    }
    for (const id of DATA_CAPABILITY_IDS) {
      if (!executors.has(id)) {
        throw new Error(`Missing Data Capability executor: ${id}.`);
      }
    }
    this.#executors = executors;
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
  }

  async execute(request: ExecuteDataCapabilityInput): Promise<unknown> {
    const definition = DATA_CAPABILITY_REGISTRY[request.capabilityId];
    const parsedContext = PlatformRequestContextSchema.safeParse(
      request.requestContext,
    );
    if (definition === undefined || !parsedContext.success) {
      throw error('NOT_AUTHENTICATED');
    }
    const requestContext = parsedContext.data;
    const occurredAt = this.#occurredAt();
    const inputHash = safeHash(request.input);
    const auditBase = {
      capabilityId: definition.id,
      actorId: requestContext.principal.actorId,
      actorType: requestContext.principal.actorType,
      ...(requestContext.principal.delegatedBy === undefined
        ? {}
        : { delegatedBy: requestContext.principal.delegatedBy }),
      tenantId: requestContext.authorization.tenantId,
      projectId: requestContext.authorization.projectId,
      purpose: requestContext.authorization.purpose,
      traceId: requestContext.traceId,
      auditLevel: definition.auditLevel,
      inputHash,
      occurredAt,
    } as const;

    const parsedInput = definition.inputSchema.safeParse(request.input);
    if (!parsedInput.success) {
      return this.#deny(auditBase, 'VALIDATION_FAILED');
    }
    if (
      definition.requiredScopes.some(
        (scope) => !requestContext.authorization.scopes.includes(scope),
      )
    ) {
      return this.#deny(auditBase, 'FORBIDDEN');
    }
    if (definition.kind === 'command') {
      if (request.idempotencyKey === undefined) {
        return this.#deny(auditBase, 'IDEMPOTENCY_KEY_REQUIRED');
      }
      if (!IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) {
        return this.#deny(auditBase, 'VALIDATION_FAILED');
      }
    }
    const effectiveMaxSecurityLevel = minimumSecurityLevel(
      requestContext.authorization.maxSecurityLevel,
      definition.maxSecurityLevel,
    );
    if (
      requestedSecurityLevels(parsedInput.data).some(
        (level) =>
          SECURITY_RANK[level] > SECURITY_RANK[effectiveMaxSecurityLevel],
      )
    ) {
      return this.#deny(auditBase, 'SECURITY_LEVEL_EXCEEDED');
    }

    const executor = this.#executors.get(definition.id)!;
    const signal = AbortSignal.timeout(definition.timeout);
    let timeoutListener: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutListener = () => reject(error('CAPABILITY_TIMEOUT'));
      signal.addEventListener('abort', timeoutListener, { once: true });
    });
    let rawOutput: unknown;
    try {
      rawOutput = await Promise.race([
        executor.execute(parsedInput.data, {
          principal: requestContext.principal,
          authorization: requestContext.authorization,
          effectiveMaxSecurityLevel,
          traceId: requestContext.traceId,
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
          auditLevel: definition.auditLevel,
          timeoutMs: definition.timeout,
          signal,
        }),
        timeout,
      ]);
    } catch (caught) {
      const handlerError = translatedExecutorError(caught);
      await this.#record({
        ...auditBase,
        decision: 'FAILED',
        errorCode: handlerError.code,
      });
      throw handlerError;
    } finally {
      if (timeoutListener !== undefined) {
        signal.removeEventListener('abort', timeoutListener);
      }
    }

    const parsedOutput = definition.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      await this.#record({
        ...auditBase,
        decision: 'FAILED',
        errorCode: 'IMPLEMENTATION_CONTRACT_VIOLATION',
      });
      throw error('IMPLEMENTATION_CONTRACT_VIOLATION');
    }
    await this.#record({
      ...auditBase,
      decision: 'SUCCEEDED',
      outputHash: safeHash(parsedOutput.data),
    });
    return parsedOutput.data;
  }

  #occurredAt(): string {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
      throw error('INVALID_CONFIGURATION');
    }
    return now.toISOString();
  }

  async #deny(
    base: Omit<
      DataCapabilityAuditRecord,
      'decision' | 'errorCode' | 'outputHash'
    >,
    code: DataCapabilityHandlerErrorCode,
  ): Promise<never> {
    await this.#record({ ...base, decision: 'DENIED', errorCode: code });
    throw error(code);
  }

  async #record(record: DataCapabilityAuditRecord): Promise<void> {
    try {
      await this.#audit.record(Object.freeze(record));
    } catch {
      throw error('AUDIT_FAILED');
    }
  }
}
