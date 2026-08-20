import {
  CreateAgentIdentityRequestSchema,
  CreateAgentVersionRequestSchema,
  CreateRunRequestSchema,
  CreateScenarioRequestSchema,
  CreateScenarioVersionRequestSchema,
  JoinRunAgentRequestSchema,
  ReplayQuerySchema,
  RunSyncRequestSchema,
  VersionCommandRequestSchema,
} from '@agent-excon/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { IdempotencyKeySchema } from './schemas.js';
import {
  ExerciseServiceError,
  type ParticipantAuthenticator,
  type ParticipantPrincipal,
} from './types.js';
import {
  V2AgentIdParamsSchema,
  V2AgentVersionIdParamsSchema,
  V2EventQuerySchema,
  V2RunAgentHeaderSchema,
  V2RunIdParamsSchema,
  V2ScenarioIdParamsSchema,
  V2ScenarioVersionIdParamsSchema,
} from './v2-schemas.js';
import type { V2ExerciseService } from './v2-types.js';
import { z } from 'zod';

const protectedRouteSchema = {
  security: [{ bearerAuth: [] }],
} as const;

const ScenarioVersionActionParamsSchema = z.strictObject({
  scenarioVersionAction: z.string().regex(/^.+:(validate|publish)$/),
});
const RunActionParamsSchema = z.strictObject({
  runAction: z.string().regex(/^.+:start$/),
});

function idempotencyKey(request: FastifyRequest): string {
  return IdempotencyKeySchema.parse(request.headers['idempotency-key']);
}

function runAgentId(request: FastifyRequest): string {
  return V2RunAgentHeaderSchema.parse(request.headers['x-run-agent-id']);
}

function authenticatedPrincipal(request: FastifyRequest): ParticipantPrincipal {
  if (request.participant === null) {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      '需要有效的 Bearer token。 / A valid bearer token is required.',
    );
  }
  return request.participant;
}

function principal(request: FastifyRequest): ParticipantPrincipal {
  const authenticated = authenticatedPrincipal(request);
  if (!authenticated.roles?.includes('operator')) {
    throw new ExerciseServiceError(
      'FORBIDDEN',
      '该操作需要 operator 权限。 / This operation requires the operator role.',
    );
  }
  return authenticated;
}

function runAgentPrincipal(
  request: FastifyRequest,
  expectedRunAgentId: string,
): ParticipantPrincipal {
  const authenticated = authenticatedPrincipal(request);
  if (
    !authenticated.roles?.includes('run_agent') ||
    !authenticated.runAgentIds?.includes(expectedRunAgentId)
  ) {
    throw new ExerciseServiceError(
      'FORBIDDEN',
      'RunAgent credential 未绑定请求的运行实例。 / The RunAgent credential is not bound to the requested instance.',
    );
  }
  return authenticated;
}

function replayPrincipal(
  request: FastifyRequest,
  query: z.infer<typeof ReplayQuerySchema>,
): ParticipantPrincipal {
  const authenticated = authenticatedPrincipal(request);
  if (authenticated.roles?.includes('operator')) return authenticated;
  if (
    query.perspective === 'agent' &&
    query.subjectId !== undefined &&
    query.deliverySemantics !== 'eligible'
  ) {
    return runAgentPrincipal(request, query.subjectId);
  }
  throw new ExerciseServiceError(
    'FORBIDDEN',
    'RunAgent 只能回放自身已发放或已确认的视角。 / A RunAgent may replay only its own issued or acknowledged view.',
  );
}

async function authenticate(
  request: FastifyRequest,
  authenticator: ParticipantAuthenticator,
): Promise<void> {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
  if (match === null) {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      '需要有效的 Bearer token。 / A valid bearer token is required.',
    );
  }
  const authenticated = await authenticator.authenticate(match[1]!);
  if (authenticated === null) {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      '需要有效的 Bearer token。 / A valid bearer token is required.',
    );
  }
  request.participant = authenticated;
}

export function registerV2Routes(
  app: FastifyInstance,
  service: V2ExerciseService,
  authenticator: ParticipantAuthenticator,
): void {
  app.register(
    (api) => {
      api.get(
        '/scenarios',
        {
          schema: {
            tags: ['scenario-v2'],
            summary: 'List published public scenarios',
          },
        },
        async () => ({ items: await service.listPublicScenarios() }),
      );
      api.get(
        '/scenarios/:scenarioId',
        {
          schema: {
            tags: ['scenario-v2'],
            summary: 'Get a published public scenario',
          },
        },
        async (request) => {
          const { scenarioId } = V2ScenarioIdParamsSchema.parse(request.params);
          return service.getPublicScenario(scenarioId);
        },
      );
      api.get(
        '/scenarios/:scenarioId/versions',
        {
          schema: {
            tags: ['scenario-v2'],
            summary: 'List immutable published scenario versions',
          },
        },
        async (request) => {
          const { scenarioId } = V2ScenarioIdParamsSchema.parse(request.params);
          return {
            items: await service.listPublicScenarioVersions(scenarioId),
          };
        },
      );
      api.get(
        '/scenario-versions/:scenarioVersionId',
        {
          schema: {
            tags: ['scenario-v2'],
            summary: 'Get an immutable published scenario version',
          },
        },
        async (request) => {
          const { scenarioVersionId } = V2ScenarioVersionIdParamsSchema.parse(
            request.params,
          );
          return service.getPublicScenarioVersion(scenarioVersionId);
        },
      );

      api.register((protectedApi) => {
        protectedApi.addHook('onRequest', async (request) =>
          authenticate(request, authenticator),
        );

        protectedApi.get(
          '/manage/scenarios',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['scenario-manage-v2'],
              summary: 'List owned scenarios including drafts',
            },
          },
          async (request) => ({
            items: await service.listManageScenarios(principal(request)),
          }),
        );
        protectedApi.post(
          '/manage/scenarios',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['scenario-manage-v2'],
              summary: 'Create a scenario catalog identity',
            },
          },
          async (request, reply) => {
            const result = await service.createScenario(
              principal(request),
              idempotencyKey(request),
              CreateScenarioRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.post(
          '/manage/scenarios/:scenarioId/versions',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['scenario-manage-v2'],
              summary: 'Create an editable scenario version draft',
            },
          },
          async (request, reply) => {
            const { scenarioId } = V2ScenarioIdParamsSchema.parse(
              request.params,
            );
            const result = await service.createScenarioVersion(
              principal(request),
              scenarioId,
              idempotencyKey(request),
              CreateScenarioVersionRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.post(
          '/manage/scenario-versions/:scenarioVersionAction',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['scenario-manage-v2'],
              summary: 'Validate or publish a scenario version draft',
            },
          },
          async (request) => {
            const { scenarioVersionAction } =
              ScenarioVersionActionParamsSchema.parse(request.params);
            const separator = scenarioVersionAction.lastIndexOf(':');
            const scenarioVersionId = scenarioVersionAction.slice(0, separator);
            const action = scenarioVersionAction.slice(separator + 1);
            const input = VersionCommandRequestSchema.parse(request.body);
            return action === 'validate'
              ? service.validateScenarioVersion(
                  principal(request),
                  scenarioVersionId,
                  idempotencyKey(request),
                  input,
                )
              : service.publishScenarioVersion(
                  principal(request),
                  scenarioVersionId,
                  idempotencyKey(request),
                  input,
                );
          },
        );

        protectedApi.get(
          '/agents',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['agent-v2'],
              summary: 'List owned AgentIdentity records',
            },
          },
          async (request) => ({
            items: await service.listAgents(principal(request)),
          }),
        );
        protectedApi.post(
          '/agents',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['agent-v2'],
              summary: 'Register an AgentIdentity',
            },
          },
          async (request, reply) => {
            const result = await service.createAgent(
              principal(request),
              idempotencyKey(request),
              CreateAgentIdentityRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.post(
          '/agents/:agentId/versions',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['agent-v2'],
              summary: 'Publish an immutable AgentVersion',
            },
          },
          async (request, reply) => {
            const { agentId } = V2AgentIdParamsSchema.parse(request.params);
            const result = await service.createAgentVersion(
              principal(request),
              agentId,
              idempotencyKey(request),
              CreateAgentVersionRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.get(
          '/agent-versions/:agentVersionId',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['agent-v2'],
              summary: 'Get an immutable AgentVersion',
            },
          },
          async (request) => {
            const { agentVersionId } = V2AgentVersionIdParamsSchema.parse(
              request.params,
            );
            return service.getAgentVersion(principal(request), agentVersionId);
          },
        );

        protectedApi.get(
          '/runs',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'List owned exercise runs',
            },
          },
          async (request) => ({
            items: await service.listRuns(principal(request)),
          }),
        );
        protectedApi.post(
          '/runs',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'Create a run pinned to a published scenario version',
            },
          },
          async (request, reply) => {
            const result = await service.createRun(
              principal(request),
              idempotencyKey(request),
              CreateRunRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.get(
          '/runs/:runId',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'Get an exercise run',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            return service.getRun(principal(request), runId);
          },
        );
        protectedApi.post(
          '/runs/:runId/agents',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'Join an AgentVersion as an independent RunAgent',
            },
          },
          async (request, reply) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            const result = await service.joinRun(
              principal(request),
              runId,
              idempotencyKey(request),
              JoinRunAgentRequestSchema.parse(request.body),
            );
            return reply.code(201).send(result);
          },
        );
        protectedApi.get(
          '/runs/:runId/agents',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'List independent RunAgent instances',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            return {
              items: await service.listRunAgents(principal(request), runId),
            };
          },
        );
        protectedApi.post(
          '/runs/:runAction',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['run-v2'],
              summary: 'Start a fully staffed multi-agent run',
            },
          },
          async (request) => {
            const { runAction } = RunActionParamsSchema.parse(request.params);
            const runId = runAction.slice(0, -':start'.length);
            return service.startRun(
              principal(request),
              runId,
              idempotencyKey(request),
              VersionCommandRequestSchema.parse(request.body),
            );
          },
        );
        protectedApi.post(
          '/runs/:runId/sync',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['agent-collaboration-v2'],
              summary: 'Issue new participant-visible resources as receipts',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            const requestedRunAgentId = runAgentId(request);
            return service.sync(
              runAgentPrincipal(request, requestedRunAgentId),
              runId,
              requestedRunAgentId,
              idempotencyKey(request),
              RunSyncRequestSchema.parse(request.body),
            );
          },
        );

        for (const [path, resourceType] of [
          ['tasks', 'task'],
          ['messages', 'message'],
          ['artifacts', 'artifact'],
          ['feedback', 'feedback'],
        ] as const) {
          protectedApi.get(
            `/runs/:runId/${path}`,
            {
              schema: {
                ...protectedRouteSchema,
                tags: ['agent-collaboration-v2'],
                summary: `Recover already-issued ${path}`,
              },
            },
            async (request) => {
              const { runId } = V2RunIdParamsSchema.parse(request.params);
              const requestedRunAgentId = runAgentId(request);
              return {
                items: await service.listIssuedResources(
                  runAgentPrincipal(request, requestedRunAgentId),
                  runId,
                  requestedRunAgentId,
                  resourceType,
                ),
              };
            },
          );
        }

        protectedApi.get(
          '/runs/:runId/events',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['replay-v2'],
              summary: 'List authoritative append-only RunEvents',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            const { after, limit } = V2EventQuerySchema.parse(request.query);
            const items = await service.listRunEvents(
              principal(request),
              runId,
              after,
              limit,
            );
            return { items, nextAfter: items.at(-1)?.runSeq ?? after };
          },
        );
        protectedApi.get(
          '/runs/:runId/replay',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['replay-v2'],
              summary:
                'Get an authoritative as-of projection and telemetry overlay',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            const query = ReplayQuerySchema.parse(request.query);
            return service.getReplay(
              replayPrincipal(request, query),
              runId,
              query,
            );
          },
        );
        protectedApi.get(
          '/runs/:runId/traces',
          {
            schema: {
              ...protectedRouteSchema,
              tags: ['observability-v2'],
              summary: 'Get the best-effort telemetry overlay for a run',
            },
          },
          async (request) => {
            const { runId } = V2RunIdParamsSchema.parse(request.params);
            const replay = await service.getReplay(
              principal(request),
              runId,
              ReplayQuerySchema.parse({ perspective: 'operator' }),
            );
            return replay.bestEffortTelemetryOverlay;
          },
        );
      });
    },
    { prefix: '/api/v2' },
  );
}
