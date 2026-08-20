import {
  ApiErrorSchema,
  BestEffortTelemetryOverlaySchema,
  PublicScenarioListSchema,
  ReplayResponseSchema,
  RunAgentListSchema,
  RunResourceListSchema,
  SyncDeliveryBatchSchema,
} from '@agent-excon/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_V2_SCENARIO_VERSION_ID,
  InMemoryV2ExerciseService,
  StaticParticipantAuthenticator,
  buildApp,
} from '../src/index.js';

const operatorToken = 'operator-a-token';
const runAgentToken = 'run-agent-a-token';
const boundRunAgentId = '00000000-0000-4000-8000-000000000011';
const headers = { authorization: `Bearer ${operatorToken}` };
const roleSlotIds = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;
const localized = (name: string) => ({
  'zh-CN': `中文 ${name}`,
  en: `English ${name}`,
});

function json(response: { readonly body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function app() {
  let sequence = 0;
  const instance = buildApp({
    logger: false,
    v2Service: new InMemoryV2ExerciseService({
      idFactory: () => {
        sequence += 1;
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
      },
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    }),
    authenticator: new StaticParticipantAuthenticator({
      [operatorToken]: {
        id: 'operator-a',
        participantVersionIds: [],
        roles: ['operator'],
      },
      [runAgentToken]: {
        id: 'run-agent-a-credential',
        participantVersionIds: [],
        roles: ['run_agent'],
        runAgentIds: [boundRunAgentId],
      },
    }),
  });
  closeCallbacks.push(() => instance.close());
  return instance;
}

async function post(
  instance: ReturnType<typeof app>,
  url: string,
  key: number,
  payload: Readonly<Record<string, unknown>>,
) {
  return instance.inject({
    method: 'POST',
    url,
    headers: {
      ...headers,
      'idempotency-key': `10000000-0000-4000-8000-${String(key).padStart(12, '0')}`,
    },
    payload,
  });
}

describe('Agent EXCON v2 HTTP walking slice', () => {
  it('serves only published scenario fields from the unauthenticated catalog', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'GET',
      url: '/api/v2/scenarios',
    });

    expect(response.statusCode).toBe(200);
    const catalog = PublicScenarioListSchema.parse(json(response));
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toMatchObject({
      lifecycle: 'PUBLISHED',
      currentVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
      requiredRoleCount: 4,
      minDistinctRequiredAgents: 4,
    });
    expect(response.body).not.toContain('draftVersionCount');
    expect(response.body).not.toContain('latestValidationStatus');

    const detail = await instance.inject({
      method: 'GET',
      url: '/api/v2/scenarios/jing-jin-ji-yongding-river',
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain('validation');
    expect(detail.body).not.toContain('updatedAt');
  });

  it('creates, validates and immutably publishes a second scenario with idempotent writes', async () => {
    const instance = app();
    const createPayload = {
      slug: 'beijing-canal-collaboration',
      title: localized('河湖联调'),
      description: localized('多智能体场景'),
      region: localized('北京'),
      simulationOnly: true,
    };
    const created = await post(
      instance,
      '/api/v2/manage/scenarios',
      1,
      createPayload,
    );
    expect(created.statusCode).toBe(201);
    const createdBody = json(created) as {
      scenario: { id: string; version: number };
    };
    expect(createdBody.scenario.version).toBe(1);

    const retried = await post(
      instance,
      '/api/v2/manage/scenarios',
      1,
      createPayload,
    );
    expect(retried.statusCode).toBe(201);
    expect(json(retried)).toEqual(createdBody);

    const conflict = await post(instance, '/api/v2/manage/scenarios', 1, {
      ...createPayload,
      slug: 'different-slug',
    });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(conflict))).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });

    const scenarioId = createdBody.scenario.id;
    const versionCreated = await post(
      instance,
      `/api/v2/manage/scenarios/${scenarioId}/versions`,
      2,
      {
        expectedScenarioVersion: 1,
        label: 'v1',
        summary: localized('首版'),
        replayStartAt: '2023-03-22T07:00:00.000Z',
        minDistinctRequiredAgents: 4,
        requiredRoles: roleSlotIds.map((id) => ({
          id,
          name: localized(id),
          mission: localized(`${id}-mission`),
          expectedArtifact: localized(`${id}-artifact`),
        })),
      },
    );
    expect(versionCreated.statusCode).toBe(201);
    const versionBody = json(versionCreated) as {
      scenarioVersion: { id: string; version: number; lifecycle: string };
    };
    expect(versionBody.scenarioVersion).toMatchObject({
      version: 1,
      lifecycle: 'DRAFT',
    });

    const validated = await post(
      instance,
      `/api/v2/manage/scenario-versions/${versionBody.scenarioVersion.id}:validate`,
      3,
      { expectedVersion: 1 },
    );
    expect(validated.statusCode).toBe(200);
    expect(json(validated)).toMatchObject({
      scenarioVersion: {
        version: 2,
        lifecycle: 'DRAFT',
        validation: { status: 'VALID', errors: [] },
      },
    });

    const published = await post(
      instance,
      `/api/v2/manage/scenario-versions/${versionBody.scenarioVersion.id}:publish`,
      4,
      { expectedVersion: 2 },
    );
    expect(published.statusCode).toBe(200);
    expect(json(published)).toMatchObject({
      scenarioVersion: { version: 3, lifecycle: 'PUBLISHED' },
    });

    const catalog = PublicScenarioListSchema.parse(
      json(await instance.inject({ method: 'GET', url: '/api/v2/scenarios' })),
    );
    expect(catalog.items.map(({ slug }) => slug)).toContain(createPayload.slug);
  });

  it('starts only after four distinct RunAgents join and exposes new work only through sync receipts', async () => {
    const instance = app();
    const agentVersionIds: string[] = [];

    for (const [index, roleSlotId] of roleSlotIds.entries()) {
      const createdAgent = await post(instance, '/api/v2/agents', 10 + index, {
        displayName: localized(roleSlotId),
        description: localized(`${roleSlotId}-agent`),
      });
      expect(createdAgent.statusCode).toBe(201);
      const agentId = (json(createdAgent) as { agent: { id: string } }).agent
        .id;
      const createdVersion = await post(
        instance,
        `/api/v2/agents/${agentId}/versions`,
        20 + index,
        {
          expectedAgentVersion: 1,
          providerKind: 'trusted-local-codex',
          model: 'codex-subscription',
          capabilities: [roleSlotId],
          protocolVersion: 'v2',
          telemetryMode: index === 3 ? 'none' : 'partial',
          skillManifestHash: `sha256:${String(index + 1).repeat(64)}`,
          toolManifestHash: `sha256:${String(index + 5).repeat(64)}`,
        },
      );
      expect(createdVersion.statusCode).toBe(201);
      agentVersionIds.push(
        (json(createdVersion) as { agentVersion: { id: string } }).agentVersion
          .id,
      );
    }

    const createdRun = await post(instance, '/api/v2/runs', 30, {
      scenarioVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
      label: localized('永定河四角色协作演练'),
      mode: 'exercise',
    });
    expect(createdRun.statusCode).toBe(201);
    const runId = (json(createdRun) as { run: { id: string } }).run.id;

    const joinedRunAgentIds: string[] = [];
    for (const [index, roleSlotId] of roleSlotIds.entries()) {
      const joined = await post(
        instance,
        `/api/v2/runs/${runId}/agents`,
        40 + index,
        {
          agentVersionId: agentVersionIds[index],
          instanceKey: `${roleSlotId}-instance`,
          roleSlotId,
        },
      );
      expect(joined.statusCode).toBe(201);
      joinedRunAgentIds.push(
        (json(joined) as { runAgent: { id: string } }).runAgent.id,
      );
      if (index === 0) {
        const understaffed = await post(
          instance,
          `/api/v2/runs/${runId}:start`,
          49,
          { expectedVersion: 1 },
        );
        expect(understaffed.statusCode).toBe(409);
        expect(ApiErrorSchema.parse(json(understaffed))).toMatchObject({
          error: { code: 'RUN_ROLE_CONFLICT' },
        });
      }
    }
    expect(new Set(joinedRunAgentIds)).toHaveLength(4);
    expect(joinedRunAgentIds[0]).toBe(boundRunAgentId);

    const listedAgents = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/agents`,
      headers,
    });
    expect(RunAgentListSchema.parse(json(listedAgents)).items).toHaveLength(4);

    const started = await post(instance, `/api/v2/runs/${runId}:start`, 50, {
      expectedVersion: 1,
    });
    expect(started.statusCode).toBe(200);
    expect(json(started)).toMatchObject({
      run: { state: 'RUNNING', version: 2 },
    });

    const runAgentId = joinedRunAgentIds[0]!;
    const resourceHeaders = {
      authorization: `Bearer ${runAgentToken}`,
      'x-run-agent-id': runAgentId,
    };

    const operatorCannotSync = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/sync`,
      headers: {
        ...headers,
        'x-run-agent-id': runAgentId,
        'idempotency-key': '10000000-0000-4000-8000-000000000059',
      },
      payload: { afterReceiptSeq: 0 },
    });
    expect(operatorCannotSync.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(json(operatorCannotSync))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    const runAgentCannotManage = await instance.inject({
      method: 'GET',
      url: '/api/v2/manage/scenarios',
      headers: { authorization: `Bearer ${runAgentToken}` },
    });
    expect(runAgentCannotManage.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(json(runAgentCannotManage))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    for (const resource of ['tasks', 'messages', 'artifacts', 'feedback']) {
      const beforeSync = await instance.inject({
        method: 'GET',
        url: `/api/v2/runs/${runId}/${resource}`,
        headers: resourceHeaders,
      });
      expect(RunResourceListSchema.parse(json(beforeSync)).items).toEqual([]);
    }

    const sync = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/sync`,
      headers: {
        ...resourceHeaders,
        'idempotency-key': '10000000-0000-4000-8000-000000000060',
      },
      payload: { afterReceiptSeq: 0, maxItems: 10 },
    });
    expect(sync.statusCode).toBe(200);
    const batch = SyncDeliveryBatchSchema.parse(json(sync));
    expect(
      batch.receipts.map(({ resourceType }) => resourceType).sort(),
    ).toEqual(['artifact', 'feedback', 'message', 'task']);
    expect(batch.fromReceiptSeq).toBe(1);
    expect(batch.throughReceiptSeq).toBe(4);

    const retried = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/sync`,
      headers: {
        ...resourceHeaders,
        'idempotency-key': '10000000-0000-4000-8000-000000000060',
      },
      payload: { afterReceiptSeq: 0, maxItems: 10 },
    });
    expect(json(retried)).toEqual(json(sync));

    const emptySync = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/sync`,
      headers: {
        ...resourceHeaders,
        'idempotency-key': '10000000-0000-4000-8000-000000000061',
      },
      payload: {
        afterReceiptSeq: batch.throughReceiptSeq,
        ack: {
          throughReceiptSeq: batch.throughReceiptSeq,
          headHash: batch.receiptHeadHash,
        },
        maxItems: 10,
      },
    });
    expect(emptySync.statusCode).toBe(200);
    expect(SyncDeliveryBatchSchema.parse(json(emptySync))).toMatchObject({
      fromReceiptSeq: null,
      throughReceiptSeq: 4,
      receipts: [],
      receiptHeadHash: batch.receiptHeadHash,
    });

    for (const resource of ['tasks', 'messages', 'artifacts', 'feedback']) {
      const listed = await instance.inject({
        method: 'GET',
        url: `/api/v2/runs/${runId}/${resource}`,
        headers: resourceHeaders,
      });
      expect(listed.statusCode).toBe(200);
      expect(RunResourceListSchema.parse(json(listed)).items).toHaveLength(1);
    }

    const replay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentId}&deliverySemantics=issued`,
      headers,
    });
    expect(replay.statusCode).toBe(200);
    const replayBody = ReplayResponseSchema.parse(json(replay));
    expect(replayBody.authoritativeProjection.receipts).toHaveLength(4);
    expect(replayBody.authoritativeProjection.events.length).toBeGreaterThan(8);
    expect(replayBody.authoritativeProjection.manifest.verified).toBe(true);
    expect(
      replayBody.authoritativeProjection.events.map(
        ({ eventType }) => eventType,
      ),
    ).toContain('receipt.acknowledged');
    expect(
      replayBody.authoritativeProjection.events
        .filter(({ streamType }) => streamType === 'run_agent')
        .every(({ streamId }) => streamId === runAgentId),
    ).toBe(true);
    expect(
      BestEffortTelemetryOverlaySchema.parse(
        replayBody.bestEffortTelemetryOverlay,
      ),
    ).toMatchObject({ bestEffort: true, gap: true, traces: [] });

    const eligibleReplay = ReplayResponseSchema.parse(
      json(
        await instance.inject({
          method: 'GET',
          url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentId}&deliverySemantics=eligible`,
          headers,
        }),
      ),
    );
    expect(
      eligibleReplay.authoritativeProjection.eligibleResources,
    ).toHaveLength(4);

    const participantReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentId}&deliverySemantics=acknowledged`,
      headers: resourceHeaders,
    });
    expect(participantReplay.statusCode).toBe(200);
    const participantProjection = ReplayResponseSchema.parse(
      json(participantReplay),
    ).authoritativeProjection;
    expect(participantProjection.runAgents.map(({ id }) => id)).toEqual([
      runAgentId,
    ]);
    expect(
      participantProjection.events
        .filter(({ streamType }) => streamType === 'run_agent')
        .every(({ streamId }) => streamId === runAgentId),
    ).toBe(true);

    for (const url of [
      `/api/v2/runs/${runId}/replay?perspective=operator`,
      `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${joinedRunAgentIds[1]}&deliverySemantics=issued`,
      `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentId}&deliverySemantics=eligible`,
    ]) {
      const forbiddenReplay = await instance.inject({
        method: 'GET',
        url,
        headers: resourceHeaders,
      });
      expect(forbiddenReplay.statusCode).toBe(403);
      expect(ApiErrorSchema.parse(json(forbiddenReplay))).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
    }
  });
});
