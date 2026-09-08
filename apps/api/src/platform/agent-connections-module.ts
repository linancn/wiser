import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AgentConnectionError,
  type AgentConnectionService,
} from '@wiser/platform-auth';
import {
  PlatformAgentAuthorizationIdSchema,
  PlatformAgentAuthorizationViewSchema,
  PlatformAgentAuthorizeCommandSchema,
  PlatformAgentConnectionViewSchema,
  PlatformAgentExchangeViewSchema,
  PlatformUuidSchema,
} from '@wiser/platform-contracts';

import type { WiserApiModule } from './modules.js';

const EmptyBody = z.strictObject({});
const AuthorizationParams = z.strictObject({
  authorizationId: PlatformAgentAuthorizationIdSchema,
});
const ConnectionParams = z.strictObject({ connectionId: PlatformUuidSchema });
const statusByCode = {
  NOT_AUTHENTICATED: 401,
  NOT_AUTHORIZED: 403,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_CONFLICT: 409,
  SECRET_NOT_RECOVERABLE: 409,
} as const;

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AgentConnectionError('VALIDATION_FAILED');
  return result.data;
}

function key(request: FastifyRequest): string {
  return parseInput(PlatformUuidSchema, request.headers['idempotency-key']);
}

type Handler = (
  token: string,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;
function protect(handler: Handler) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = /^Bearer ([^\s]{1,16384})$/.exec(
        request.headers.authorization ?? '',
      )?.[1];
      if (token === undefined)
        throw new AgentConnectionError('NOT_AUTHENTICATED');
      return await handler(token, request, reply);
    } catch (error) {
      const code =
        error instanceof AgentConnectionError
          ? error.code
          : 'AGENT_ACCESS_UNAVAILABLE';
      const status =
        error instanceof AgentConnectionError ? statusByCode[error.code] : 503;
      return reply.status(status).send({
        code,
        message:
          '无法完成智能体连接操作。 / The Agent connection operation could not be completed.',
      });
    }
  };
}

export function createPlatformAgentConnectionsModule(
  service: AgentConnectionService,
): WiserApiModule {
  return {
    id: 'platform.agent-connections',
    async register(app) {
      await app.register((scope) => {
        scope.addHook('onRequest', (_request, reply, done) => {
          reply.header('Cache-Control', 'private, no-store');
          reply.header('Pragma', 'no-cache');
          reply.header('Expires', '0');
          done();
        });
        scope.get(
          '/api/platform/v1/agent-authorizations/:authorizationId',
          protect(async (token, request) => {
            const { authorizationId } = parseInput(
              AuthorizationParams,
              request.params,
            );
            return PlatformAgentAuthorizationViewSchema.parse(
              await service.inspect({ token, authorizationId }),
            );
          }),
        );
        scope.get(
          '/api/platform/v1/agent-connections',
          protect(async (token) => ({
            connections: z
              .array(PlatformAgentConnectionViewSchema)
              .max(100)
              .parse(await service.list({ token })),
          })),
        );
        scope.post(
          '/api/platform/v1/agent-connections',
          { bodyLimit: 16_384 },
          protect(async (token, request, reply) => {
            const idempotencyKey = key(request);
            const command = parseInput(
              PlatformAgentAuthorizeCommandSchema,
              request.body,
            );
            const result = PlatformAgentConnectionViewSchema.parse(
              await service.authorize({ token, idempotencyKey, command }),
            );
            return reply.status(201).send(result);
          }),
        );
        scope.post(
          '/api/platform/v1/agent-connections/exchange',
          { bodyLimit: 16_384 },
          protect(async (token, request) => {
            const idempotencyKey = key(request);
            parseInput(EmptyBody, request.body);
            return PlatformAgentExchangeViewSchema.parse(
              await service.exchange({ token, idempotencyKey }),
            );
          }),
        );
        scope.post(
          '/api/platform/v1/agent-connections/:connectionId/revoke',
          { bodyLimit: 16_384 },
          protect(async (token, request, reply) => {
            const idempotencyKey = key(request);
            const { connectionId } = parseInput(
              ConnectionParams,
              request.params,
            );
            parseInput(EmptyBody, request.body);
            await service.revoke({ token, idempotencyKey, connectionId });
            return reply.status(204).send();
          }),
        );
        return Promise.resolve();
      });
    },
  };
}
