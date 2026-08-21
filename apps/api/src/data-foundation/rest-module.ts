import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
  OperationEventPageSchema,
  type DataCapabilityId,
} from '@wiser/data-contracts';
import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import {
  DataCapabilityHandlerError,
  type ExecuteDataCapabilityInput,
} from './capability-handler.js';
import type { WiserApiModule } from '../platform/modules.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSIONED_COMMANDS = new Set<DataCapabilityId>([
  'data.ingestion.submit',
  'data.uploadSession.complete',
  'data.ingestion.approve',
  'data.ingestion.reject',
  'data.operation.cancel',
]);
const ARRAY_QUERY_FIELDS = new Set([
  'businessDomains',
  'processingStages',
  'securityLevels',
  'qualityGrades',
  'acceptanceStatuses',
  'sources',
  'dataItemIds',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface DataFoundationRequestContextResolver {
  resolve(input: {
    readonly token: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly purpose: string;
    readonly traceId: string;
  }): Promise<PlatformRequestContext | null>;
}

export interface DataFoundationRestCapabilityHandler {
  readonly execute: (input: ExecuteDataCapabilityInput) => Promise<unknown>;
}

export interface DataFoundationRestModuleOptions {
  readonly resolver: DataFoundationRequestContextResolver;
  readonly handler: DataFoundationRestCapabilityHandler;
}

interface ErrorMapping {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

function singleHeader(value: string | readonly string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function bearerToken(value: string | undefined): string | null {
  return /^Bearer ([^\s]+)$/.exec(value ?? '')?.[1] ?? null;
}

function setNoStore(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate',
  );
  reply.header('Expires', '0');
  reply.header('Pragma', 'no-cache');
}

function traceId(request: FastifyRequest): string {
  const candidate = request.id.replaceAll('-', '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(candidate)
    ? candidate
    : createHash('sha256').update(request.id).digest('hex').slice(0, 32);
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  mapping: ErrorMapping,
) {
  setNoStore(reply);
  return reply.status(mapping.status).send({
    code: mapping.code,
    message: mapping.message,
    traceId: traceId(request),
  });
}

const errors = {
  unauthenticated: {
    status: 401,
    code: 'NOT_AUTHENTICATED',
    message:
      '需要 Bearer credential、Tenant、Project 与 Purpose。 / Bearer credential, Tenant, Project, and Purpose are required.',
  },
  unauthorized: {
    status: 403,
    code: 'NOT_AUTHORIZED',
    message:
      '当前身份无权访问该数据项目上下文。 / The current identity is not authorized for this data project context.',
  },
  validation: {
    status: 422,
    code: 'VALIDATION_FAILED',
    message:
      '数据能力请求未通过校验。 / The Data Capability request failed validation.',
  },
  idempotency: {
    status: 422,
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    message:
      '写操作需要 UUID Idempotency-Key。 / Commands require a UUID Idempotency-Key.',
  },
  forbidden: {
    status: 403,
    code: 'FORBIDDEN',
    message:
      '当前身份无权执行该数据能力。 / The current identity cannot execute this Data Capability.',
  },
  conflict: {
    status: 409,
    code: 'CONFLICT',
    message:
      '资源状态或版本已发生变化。 / The resource state or version has changed.',
  },
  notFound: {
    status: 404,
    code: 'NOT_FOUND',
    message:
      '请求的数据资源不存在。 / The requested data resource was not found.',
  },
  unavailable: {
    status: 503,
    code: 'CAPABILITY_UNAVAILABLE',
    message:
      '数据能力暂时不可用。 / The Data Capability is temporarily unavailable.',
  },
  internal: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message:
      '服务暂时无法完成请求。 / The service could not complete the request.',
  },
} as const satisfies Readonly<Record<string, ErrorMapping>>;

function ownErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return typeof descriptor?.value === 'string' ? descriptor.value : null;
}

function mapError(error: unknown): ErrorMapping {
  if (error instanceof DataCapabilityHandlerError) {
    switch (error.code) {
      case 'NOT_AUTHENTICATED':
        return errors.unauthenticated;
      case 'FORBIDDEN':
      case 'SECURITY_LEVEL_EXCEEDED':
        return errors.forbidden;
      case 'NOT_FOUND':
        return errors.notFound;
      case 'CONFLICT':
        return errors.conflict;
      case 'VALIDATION_FAILED':
        return errors.validation;
      case 'IDEMPOTENCY_KEY_REQUIRED':
        return errors.idempotency;
      case 'CAPABILITY_TIMEOUT':
      case 'EXECUTION_FAILED':
        return errors.unavailable;
      case 'INVALID_CONFIGURATION':
      case 'IMPLEMENTATION_CONTRACT_VIOLATION':
      case 'AUDIT_FAILED':
        return errors.internal;
    }
  }
  const code = ownErrorCode(error);
  if (
    code === 'CONFLICT' ||
    code === 'VERSION_CONFLICT' ||
    code === 'STATE_CONFLICT' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code?.endsWith('_VERSION_CONFLICT') === true ||
    code?.endsWith('_STATE_CONFLICT') === true
  ) {
    return errors.conflict;
  }
  if (code === 'NOT_FOUND' || code?.endsWith('_NOT_FOUND') === true) {
    return errors.notFound;
  }
  if (code === 'FORBIDDEN' || code === 'NOT_AUTHORIZED') {
    return errors.forbidden;
  }
  if (code === 'VALIDATION_FAILED') return errors.validation;
  return errors.internal;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function normalizeQuery(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  const source = record(value);
  if (source === null) return null;
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
    if (key === 'first') {
      if (typeof entry !== 'string' || !/^[1-9]\d{0,2}$/.test(entry)) {
        return null;
      }
      normalized[key] = Number(entry);
      continue;
    }
    if (ARRAY_QUERY_FIELDS.has(key)) {
      const values = queryStringArray(entry);
      if (
        values === null ||
        values.length > 256 ||
        !values.every((item) => typeof item === 'string' && item.length > 0)
      ) {
        return null;
      }
      normalized[key] = [...values];
      continue;
    }
    if (typeof entry !== 'string') return null;
    normalized[key] = entry;
  }
  return normalized;
}

function composeInput(request: FastifyRequest): Record<string, unknown> | null {
  const parts: readonly (Readonly<Record<string, unknown>> | null)[] = [
    record(request.params ?? {}),
    normalizeQuery(request.query ?? {}),
    request.body === undefined ? {} : record(request.body),
  ];
  if (parts.some((part) => part === null)) return null;
  const result: Record<string, unknown> = {};
  for (const part of parts) {
    if (part === null) continue;
    for (const [key, value] of Object.entries(part)) {
      if (FORBIDDEN_KEYS.has(key) || Object.hasOwn(result, key)) return null;
      result[key] = value;
    }
  }
  return result;
}

function queryStringArray(value: unknown): readonly string[] | null {
  if (typeof value === 'string') return value.split(',');
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') return null;
    result.push(entry);
  }
  return result;
}

function parseIfMatch(value: string | undefined): number | null {
  const match = /^"v([1-9]\d*)"$/.exec(value ?? '');
  if (match?.[1] === undefined) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function enforceIfMatch(
  capabilityId: DataCapabilityId,
  input: Record<string, unknown>,
  header: string | undefined,
): boolean {
  if (!VERSIONED_COMMANDS.has(capabilityId)) return true;
  const version = parseIfMatch(header);
  if (version === null) return false;
  if (input['expectedVersion'] === undefined) {
    input['expectedVersion'] = version;
    return true;
  }
  return input['expectedVersion'] === version;
}

function responseVersion(value: unknown, depth = 0): number | null {
  if (depth > 3) return null;
  const candidate = record(value);
  if (candidate === null) return null;
  const direct = candidate['version'];
  if (
    typeof direct === 'number' &&
    Number.isSafeInteger(direct) &&
    direct > 0
  ) {
    return direct;
  }
  for (const key of [
    'item',
    'selectedVersion',
    'ingestion',
    'uploadSession',
    'operation',
  ]) {
    const nested = responseVersion(candidate[key], depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function sseSnapshot(output: unknown): {
  readonly body: string;
  readonly nextCursor?: string;
} | null {
  const parsed = OperationEventPageSchema.safeParse(output);
  if (!parsed.success) return null;
  const body = parsed.data.items
    .map(
      (event) =>
        `id: ${event.eventId}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('');
  return {
    body: body.length === 0 ? ': snapshot\n\n' : body,
    ...(parsed.data.nextCursor === undefined
      ? {}
      : { nextCursor: parsed.data.nextCursor }),
  };
}

async function resolveContext(
  request: FastifyRequest,
  resolver: DataFoundationRequestContextResolver,
): Promise<
  | { readonly context: PlatformRequestContext }
  | { readonly error: ErrorMapping }
> {
  const token = bearerToken(singleHeader(request.headers.authorization));
  const tenantId = singleHeader(request.headers['x-wiser-tenant-id']);
  const projectId = singleHeader(request.headers['x-wiser-project-id']);
  const purpose = singleHeader(request.headers['x-wiser-purpose']);
  if (
    token === null ||
    tenantId === undefined ||
    projectId === undefined ||
    purpose === undefined
  ) {
    return { error: errors.unauthenticated };
  }
  let rawContext: PlatformRequestContext | null;
  try {
    rawContext = await resolver.resolve({
      token,
      tenantId,
      projectId,
      purpose,
      traceId: traceId(request),
    });
  } catch {
    return { error: errors.unavailable };
  }
  const parsed = PlatformRequestContextSchema.safeParse(rawContext);
  if (
    !parsed.success ||
    parsed.data.authorization.tenantId !== tenantId ||
    parsed.data.authorization.projectId !== projectId ||
    parsed.data.authorization.purpose !== purpose
  ) {
    return { error: errors.unauthorized };
  }
  return { context: parsed.data };
}

export function createDataFoundationRestModule(
  options: DataFoundationRestModuleOptions,
): WiserApiModule {
  if (
    options.resolver === null ||
    typeof options.resolver?.resolve !== 'function' ||
    options.handler === null ||
    typeof options.handler?.execute !== 'function'
  ) {
    throw new Error('Invalid Data Foundation REST module configuration.');
  }
  return {
    id: 'data.foundation.rest',
    register(app) {
      for (const capabilityId of DATA_CAPABILITY_IDS) {
        const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
        app.route({
          method: definition.restMapping.method,
          url: definition.restMapping.path,
          handler: async (request, reply) => {
            setNoStore(reply);
            const resolved = await resolveContext(request, options.resolver);
            if ('error' in resolved) {
              return sendError(request, reply, resolved.error);
            }
            const input = composeInput(request);
            if (input === null) {
              return sendError(request, reply, errors.validation);
            }
            const idempotencyKey = singleHeader(
              request.headers['idempotency-key'],
            );
            if (definition.kind === 'command') {
              if (idempotencyKey === undefined) {
                return sendError(request, reply, errors.idempotency);
              }
              if (!UUID_PATTERN.test(idempotencyKey)) {
                return sendError(request, reply, errors.validation);
              }
            }
            if (
              !enforceIfMatch(
                capabilityId,
                input,
                singleHeader(request.headers['if-match']),
              )
            ) {
              return sendError(request, reply, errors.validation);
            }

            let output: unknown;
            try {
              output = await options.handler.execute({
                capabilityId,
                input,
                requestContext: resolved.context,
                ...(definition.kind === 'command' &&
                idempotencyKey !== undefined
                  ? { idempotencyKey }
                  : {}),
              });
            } catch (error) {
              return sendError(request, reply, mapError(error));
            }

            if (definition.restMapping.responseMode === 'SSE') {
              const snapshot = sseSnapshot(output);
              if (snapshot === null) {
                return sendError(request, reply, errors.internal);
              }
              reply.header('Content-Type', 'text/event-stream; charset=utf-8');
              reply.header('Connection', 'keep-alive');
              reply.header('X-Accel-Buffering', 'no');
              if (snapshot.nextCursor !== undefined) {
                reply.header('X-Next-Cursor', snapshot.nextCursor);
              }
              return reply
                .status(definition.restMapping.successStatus)
                .send(snapshot.body);
            }

            const version = responseVersion(output);
            if (version !== null) reply.header('ETag', `"v${version}"`);
            return reply
              .status(definition.restMapping.successStatus)
              .send(output);
          },
        });
      }
    },
  };
}
