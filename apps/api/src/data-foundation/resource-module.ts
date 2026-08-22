import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import {
  DataFoundationResourceError,
  type DataFoundationResourcePort,
} from './resource-types.js';
import type { WiserApiModule } from '../platform/modules.js';

export { DataFoundationResourceError } from './resource-types.js';

const MAX_RESOURCE_RESPONSE_BYTES = 262_144;
const EvidenceParamsSchema = z.strictObject({ evidenceId: z.string().uuid() });
const StacParamsSchema = z.strictObject({
  collectionId: z.string().regex(/^wiser-[a-f0-9]{32}$/),
  itemId: z.string().regex(/^wiser-[a-f0-9]{48}$/),
});

export interface DataFoundationResourceContextResolver {
  resolve(input: {
    readonly token: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly purpose: string;
    readonly traceId: string;
  }): Promise<PlatformRequestContext | null>;
}

export interface DataFoundationResourceModuleOptions {
  readonly resolver: DataFoundationResourceContextResolver;
  readonly resources: DataFoundationResourcePort;
}

interface ErrorMapping {
  readonly status: number;
  readonly code: string;
  readonly message: string;
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
  forbidden: {
    status: 403,
    code: 'FORBIDDEN',
    message:
      '当前身份无权读取该数据资源。 / The current identity cannot read this data resource.',
  },
  validation: {
    status: 422,
    code: 'VALIDATION_FAILED',
    message:
      '数据资源引用未通过校验。 / The data resource reference failed validation.',
  },
  notFound: {
    status: 404,
    code: 'DATA_RESOURCE_NOT_FOUND',
    message:
      '请求的数据资源不存在。 / The requested data resource was not found.',
  },
  tooLarge: {
    status: 413,
    code: 'DATA_RESOURCE_TOO_LARGE',
    message:
      '数据资源超过安全响应上限。 / The data resource exceeds the safe response limit.',
  },
  invalidResponse: {
    status: 502,
    code: 'DATA_RESOURCE_INVALID',
    message:
      '数据资源投影响应无效。 / The data resource projection response is invalid.',
  },
  unavailable: {
    status: 503,
    code: 'DATA_RESOURCE_UNAVAILABLE',
    message:
      '数据资源暂时不可用。 / The data resource is temporarily unavailable.',
  },
  internal: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message:
      '服务暂时无法完成请求。 / The service could not complete the request.',
  },
} as const satisfies Readonly<Record<string, ErrorMapping>>;

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

function mapError(error: unknown): ErrorMapping {
  if (!(error instanceof DataFoundationResourceError)) return errors.internal;
  switch (error.code) {
    case 'NOT_FOUND':
      return errors.notFound;
    case 'RESPONSE_TOO_LARGE':
      return errors.tooLarge;
    case 'INVALID_RESPONSE':
      return errors.invalidResponse;
    case 'UNAVAILABLE':
      return errors.unavailable;
  }
}

async function resolveContext(
  request: FastifyRequest,
  resolver: DataFoundationResourceContextResolver,
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
  let candidate: PlatformRequestContext | null;
  try {
    candidate = await resolver.resolve({
      token,
      tenantId,
      projectId,
      purpose,
      traceId: traceId(request),
    });
  } catch {
    return { error: errors.unavailable };
  }
  const parsed = PlatformRequestContextSchema.safeParse(candidate);
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

function sendResource(
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: unknown,
) {
  const parsed = z.json().safeParse(candidate);
  if (!parsed.success || parsed.data === null || Array.isArray(parsed.data)) {
    return sendError(request, reply, errors.invalidResponse);
  }
  const serialized = JSON.stringify(parsed.data);
  if (Buffer.byteLength(serialized) > MAX_RESOURCE_RESPONSE_BYTES) {
    return sendError(request, reply, errors.tooLarge);
  }
  setNoStore(reply);
  return reply.type('application/json; charset=utf-8').send(serialized);
}

export function createDataFoundationResourceModule(
  options: DataFoundationResourceModuleOptions,
): WiserApiModule {
  if (
    options.resolver === null ||
    typeof options.resolver?.resolve !== 'function' ||
    options.resources === null ||
    typeof options.resources?.readEvidence !== 'function' ||
    typeof options.resources?.readStacItem !== 'function'
  ) {
    throw new Error('Invalid Data Foundation Resource module configuration.');
  }
  return {
    id: 'data.foundation.resources',
    register(app) {
      app.get(
        '/api/data/v1/evidence/fragments/:evidenceId',
        async (request, reply) => {
          setNoStore(reply);
          const params = EvidenceParamsSchema.safeParse(request.params);
          if (!params.success) {
            return sendError(request, reply, errors.validation);
          }
          const resolved = await resolveContext(request, options.resolver);
          if ('error' in resolved) {
            return sendError(request, reply, resolved.error);
          }
          if (
            !resolved.context.authorization.scopes.includes(
              'data.knowledge.read',
            )
          ) {
            return sendError(request, reply, errors.forbidden);
          }
          try {
            return sendResource(
              request,
              reply,
              await options.resources.readEvidence({
                context: resolved.context,
                evidenceId: params.data.evidenceId,
              }),
            );
          } catch (error) {
            return sendError(request, reply, mapError(error));
          }
        },
      );

      app.get(
        '/api/data/v1/stac/collections/:collectionId/items/:itemId',
        async (request, reply) => {
          setNoStore(reply);
          const params = StacParamsSchema.safeParse(request.params);
          if (!params.success) {
            return sendError(request, reply, errors.validation);
          }
          const resolved = await resolveContext(request, options.resolver);
          if ('error' in resolved) {
            return sendError(request, reply, resolved.error);
          }
          if (
            !resolved.context.authorization.scopes.includes('data.geo.read')
          ) {
            return sendError(request, reply, errors.forbidden);
          }
          try {
            return sendResource(
              request,
              reply,
              await options.resources.readStacItem({
                context: resolved.context,
                collectionId: params.data.collectionId,
                itemId: params.data.itemId,
              }),
            );
          } catch (error) {
            return sendError(request, reply, mapError(error));
          }
        },
      );
    },
  };
}
