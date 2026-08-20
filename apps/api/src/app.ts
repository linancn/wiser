import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { DomainError } from '@agent-excon/core';
import { z, ZodError, type ZodType } from 'zod';

import { StaticParticipantAuthenticator } from './auth.js';
import { InMemoryExerciseService } from './in-memory-service.js';
import {
  AdvanceBodySchema,
  CreateEpisodeBodySchema,
  EpisodeIdParamsSchema,
  EventQuerySchema,
  IdempotencyKeySchema,
  ObservationQuerySchema,
  ObserveBodySchema,
  SubmissionIdParamsSchema,
  SubmitPlanBodySchema,
} from './schemas.js';
import {
  ExerciseServiceError,
  type ApiErrorCode,
  type ExerciseService,
  type ParticipantAuthenticator,
  type ParticipantPrincipal,
} from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    participant: ParticipantPrincipal | null;
  }
}

export interface BuildAppOptions {
  readonly service?: ExerciseService;
  readonly authenticator?: ParticipantAuthenticator;
  readonly corsOrigin?: string | readonly string[];
  readonly logger?: boolean;
}

interface ErrorMapping {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

const publicErrorStatus: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  EPISODE_NOT_FOUND: 404,
  EPISODE_VERSION_CONFLICT: 409,
  EPISODE_STATE_CONFLICT: 409,
  EVIDENCE_NOT_OBSERVED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  NOT_AUTHORIZED: 401,
  INTERNAL_ERROR: 500,
};

const knownDomainCodes = new Set<ApiErrorCode>([
  'EPISODE_VERSION_CONFLICT',
  'EPISODE_STATE_CONFLICT',
  'EVIDENCE_NOT_OBSERVED',
]);

function validationDetails(error: ZodError): Readonly<Record<string, unknown>> {
  return {
    issues: error.issues.map(({ code, message, path }) => ({
      code,
      message,
      path,
    })),
  };
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ExerciseServiceError(
      'VALIDATION_FAILED',
      '请求未通过校验。 / The request failed validation.',
      validationDetails(result.error),
    );
  }
  return result.data;
}

function idempotencyKey(request: FastifyRequest): string {
  return parse(IdempotencyKeySchema, request.headers['idempotency-key']);
}

function principal(request: FastifyRequest): ParticipantPrincipal {
  if (request.participant === null) {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      '需要有效的参与者 Bearer token。 / A valid participant bearer token is required.',
    );
  }
  return request.participant;
}

function mapError(error: unknown): ErrorMapping {
  if (error instanceof ExerciseServiceError) {
    return {
      code: error.code,
      status: publicErrorStatus[error.code],
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof DomainError) {
    const code = knownDomainCodes.has(error.code as ApiErrorCode)
      ? (error.code as ApiErrorCode)
      : 'VALIDATION_FAILED';
    return {
      code,
      status: publicErrorStatus[code],
      message: error.message,
    };
  }
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      status: 422,
      message: '请求未通过校验。 / The request failed validation.',
      details: validationDetails(error),
    };
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.validation !== undefined) {
    return {
      code: 'VALIDATION_FAILED',
      status: 422,
      message: '请求未通过校验。 / The request failed validation.',
      details: { issues: fastifyError.validation },
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message:
      '服务暂时无法完成请求。 / The service could not complete the request.',
  };
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  mapping: ErrorMapping,
): void {
  void reply.code(mapping.status).send({
    error: {
      code: mapping.code,
      message: mapping.message,
      ...(mapping.details === undefined ? {} : { details: mapping.details }),
      traceId: request.id,
    },
  });
}

function jsonSchema(schema: ZodType): Readonly<Record<string, unknown>> {
  return z.toJSONSchema(schema, { target: 'draft-7' });
}

const idempotencyHeadersSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', format: 'uuid' },
  },
} as const;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const service = options.service ?? new InMemoryExerciseService();
  const authenticator =
    options.authenticator ??
    new StaticParticipantAuthenticator({
      'local-demo-participant-token': 'local-demo-participant',
    });
  const app = fastify({
    logger: options.logger ?? true,
    genReqId: () => randomUUID(),
  });
  app.decorateRequest('participant', null);
  app.setErrorHandler((error, request, reply) => {
    const mapping = mapError(error);
    if (mapping.code === 'INTERNAL_ERROR') {
      request.log.error({ err: error }, 'unhandled API error');
    }
    sendError(request, reply, mapping);
  });
  app.setNotFoundHandler((request, reply) => {
    sendError(request, reply, {
      code: 'VALIDATION_FAILED',
      status: 404,
      message:
        '请求的 API 路由不存在。 / The requested API route does not exist.',
    });
  });
  const configuredCorsOrigin = options.corsOrigin;
  app.register(cors, {
    origin:
      configuredCorsOrigin === undefined
        ? false
        : typeof configuredCorsOrigin === 'string'
          ? configuredCorsOrigin
          : [...configuredCorsOrigin],
    credentials: false,
  });
  app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Agent EXCON API',
        description:
          '面向 Skill/MCP 的京津冀永定河演练 API / Skill/MCP-facing Jing-Jin-Ji Yongding River exercise API',
        version: '0.1.0',
      },
      tags: [
        { name: 'health', description: 'Service health' },
        { name: 'exercise', description: 'Skill-driven exercise workflow' },
        { name: 'trace', description: 'Participant-visible trace data' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'participant-token',
          },
        },
      },
    },
  });

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness check',
      },
    },
    () => ({ status: 'ok', live: true }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness check',
      },
    },
    async (_request, reply) => {
      const ready = await service.isReady();
      return reply
        .code(ready ? 200 : 503)
        .send({ status: ready ? 'ready' : 'not_ready', ready });
    },
  );
  app.get('/openapi.json', { schema: { hide: true } }, (_request, reply) =>
    reply.send(app.swagger()),
  );

  app.register(
    (api, _pluginOptions, done) => {
      api.addHook('onRequest', async (request) => {
        const authorization = request.headers.authorization;
        const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
        if (match === null) {
          throw new ExerciseServiceError(
            'NOT_AUTHORIZED',
            '需要有效的参与者 Bearer token。 / A valid participant bearer token is required.',
          );
        }
        const authenticated = await authenticator.authenticate(match[1]!);
        if (authenticated === null) {
          throw new ExerciseServiceError(
            'NOT_AUTHORIZED',
            '需要有效的参与者 Bearer token。 / A valid participant bearer token is required.',
          );
        }
        request.participant = authenticated;
      });

      api.get(
        '/scenario',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Get the default 2023 exercise scenario',
            security: [{ bearerAuth: [] }],
          },
        },
        async (request) => service.getScenario(principal(request)),
      );

      api.post(
        '/episodes',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Start an exercise episode',
            security: [{ bearerAuth: [] }],
            headers: idempotencyHeadersSchema,
            body: jsonSchema(CreateEpisodeBodySchema),
          },
        },
        async (request, reply) => {
          const body = parse(CreateEpisodeBodySchema, request.body);
          const result = await service.createEpisode(
            principal(request),
            idempotencyKey(request),
            body,
          );
          return reply.code(201).send(result);
        },
      );

      api.get(
        '/episodes/:episodeId',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Get an episode',
            security: [{ bearerAuth: [] }],
            params: jsonSchema(EpisodeIdParamsSchema),
          },
        },
        async (request) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          return service.getEpisode(principal(request), episodeId);
        },
      );

      api.post(
        '/episodes/:episodeId/observe',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Record access to released observations',
            security: [{ bearerAuth: [] }],
            headers: idempotencyHeadersSchema,
            params: jsonSchema(EpisodeIdParamsSchema),
            body: jsonSchema(ObserveBodySchema),
          },
        },
        async (request) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const body = parse(ObserveBodySchema, request.body);
          return service.observe(
            principal(request),
            episodeId,
            idempotencyKey(request),
            {
              episodeVersion: body.episodeVersion,
              ...(body.informationIds === undefined
                ? {}
                : { informationIds: body.informationIds }),
            },
          );
        },
      );

      api.get(
        '/episodes/:episodeId/observations',
        {
          schema: {
            tags: ['trace'],
            summary: 'List observations already accessed by the participant',
            security: [{ bearerAuth: [] }],
            params: jsonSchema(EpisodeIdParamsSchema),
            querystring: jsonSchema(ObservationQuerySchema),
          },
        },
        async (request) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const { limit } = parse(ObservationQuerySchema, request.query);
          const items = await service.listObservations(
            principal(request),
            episodeId,
            limit,
          );
          return { items, links: { episode: `/api/v1/episodes/${episodeId}` } };
        },
      );

      api.post(
        '/episodes/:episodeId/submissions',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Submit and deterministically evaluate an allocation plan',
            security: [{ bearerAuth: [] }],
            headers: idempotencyHeadersSchema,
            params: jsonSchema(EpisodeIdParamsSchema),
            body: jsonSchema(SubmitPlanBodySchema),
          },
        },
        async (request, reply) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const body = parse(SubmitPlanBodySchema, request.body);
          const result = await service.submitPlan(
            principal(request),
            episodeId,
            idempotencyKey(request),
            body,
          );
          return reply.code(201).send(result);
        },
      );

      api.get(
        '/submissions/:submissionId/evaluation',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Reconcile deterministic evaluation status',
            security: [{ bearerAuth: [] }],
            params: jsonSchema(SubmissionIdParamsSchema),
          },
        },
        async (request, reply) => {
          const { submissionId } = parse(
            SubmissionIdParamsSchema,
            request.params,
          );
          const result = await service.getSubmissionEvaluation(
            principal(request),
            submissionId,
          );
          return reply
            .code(result.status === 'pending' ? 202 : 200)
            .send(result);
        },
      );

      api.get(
        '/episodes/:episodeId/feedback',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Get visible feedback',
            security: [{ bearerAuth: [] }],
            params: jsonSchema(EpisodeIdParamsSchema),
          },
        },
        async (request, reply) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const result = await service.getFeedback(
            principal(request),
            episodeId,
          );
          if (result.status === 'pending') {
            return reply.code(202).send(result);
          }
          return reply.code(200).send(result.feedback);
        },
      );

      api.post(
        '/episodes/:episodeId/advance',
        {
          schema: {
            tags: ['exercise'],
            summary: 'Advance or complete an episode',
            security: [{ bearerAuth: [] }],
            headers: idempotencyHeadersSchema,
            params: jsonSchema(EpisodeIdParamsSchema),
            body: jsonSchema(AdvanceBodySchema),
          },
        },
        async (request) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const body = parse(AdvanceBodySchema, request.body);
          return service.advance(
            principal(request),
            episodeId,
            idempotencyKey(request),
            body,
          );
        },
      );

      api.get(
        '/episodes/:episodeId/events',
        {
          schema: {
            tags: ['trace'],
            summary: 'List append-only participant-visible episode events',
            security: [{ bearerAuth: [] }],
            params: jsonSchema(EpisodeIdParamsSchema),
            querystring: jsonSchema(EventQuerySchema),
          },
        },
        async (request) => {
          const { episodeId } = parse(EpisodeIdParamsSchema, request.params);
          const { after, limit } = parse(EventQuerySchema, request.query);
          const items = await service.listEvents(
            principal(request),
            episodeId,
            after,
            limit,
          );
          return {
            items,
            nextAfter: items.at(-1)?.sequence ?? after,
            links: { episode: `/api/v1/episodes/${episodeId}` },
          };
        },
      );
      done();
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => service.close());
  return app;
}
