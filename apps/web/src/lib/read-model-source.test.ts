import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLiveReadModelSource,
  createReferenceReadModelSource,
} from './read-model-source';

const RUN_ID = '0f6a20fb-8138-4723-8c3c-77d2e0b7f2bd';
const OTHER_RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_AGENT_ID = '4d41f32a-cb6e-475f-939f-e37de25822ce';
const AGENT_VERSION_ID = '657e99e9-46e2-4ddb-a8de-57273c62b146';
const SCENARIO_ID = 'yongding-live';
const SCENARIO_VERSION_ID = 'yongding-live-v2';
const OTHER_SCENARIO_VERSION_ID = 'yongding-live-v3';
const HASH = `sha256:${'a'.repeat(64)}`;

const localized = (zhCN: string, en: string) => ({ 'zh-CN': zhCN, en });

const scenario = {
  id: SCENARIO_ID,
  slug: SCENARIO_ID,
  title: localized('永定河实时场景', 'Live Yongding scenario'),
  description: localized('实时只读投影', 'Live read-only projection'),
  region: localized('京津冀 · 永定河', 'Jing-Jin-Ji · Yongding River'),
  simulationOnly: true,
  lifecycle: 'PUBLISHED',
  currentVersionId: SCENARIO_VERSION_ID,
  publishedVersionCount: 1,
  requiredRoleCount: 2,
  minDistinctRequiredAgents: 2,
} as const;

const scenarioVersion = {
  id: SCENARIO_VERSION_ID,
  scenarioId: SCENARIO_ID,
  label: 'v2',
  summary: localized('双智能体协作', 'Two-agent collaboration'),
  lifecycle: 'PUBLISHED',
  replayStartAt: '2026-08-20T00:00:00.000Z',
  requiredRoles: [
    {
      id: 'inflow-analysis',
      name: localized('来水研判', 'Inflow analysis'),
      mission: localized('核验来水', 'Verify inflow'),
      expectedArtifact: localized('来水工件', 'Inflow artifact'),
    },
    {
      id: 'dispatch-coordination',
      name: localized('调度协调', 'Dispatch coordination'),
      mission: localized('汇聚方案', 'Converge the plan'),
      expectedArtifact: localized('联合方案', 'Joint plan'),
    },
  ],
  minDistinctRequiredAgents: 2,
  contentHash: HASH,
  publishedAt: '2026-08-20T00:00:00.000Z',
} as const;

const run = {
  id: RUN_ID,
  scenarioVersionId: SCENARIO_VERSION_ID,
  ownerId: 'operator-1',
  label: localized('永定河实时运行', 'Live Yongding run'),
  mode: 'exercise',
  state: 'RUNNING',
  virtualTime: '2026-08-20T06:00:00.000Z',
  version: 3,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T06:00:00.000Z',
  startedAt: '2026-08-20T00:05:00.000Z',
} as const;

const runAgent = {
  id: RUN_AGENT_ID,
  runId: RUN_ID,
  agentVersionId: AGENT_VERSION_ID,
  instanceKey: 'inflow-agent-1',
  roleSlotId: 'inflow-analysis',
  state: 'WORKING',
  version: 2,
  joinedAt: '2026-08-20T00:01:00.000Z',
} as const;

const event = {
  eventId: 'd37c450a-8f80-4714-84fb-19242719ad61',
  runId: RUN_ID,
  runSeq: 1,
  streamType: 'run',
  streamId: RUN_ID,
  eventType: 'run.started',
  actorType: 'operator',
  actorId: 'operator-1',
  virtualTime: '2026-08-20T00:05:00.000Z',
  occurredAt: '2026-08-20T00:05:00.000Z',
  recordedAt: '2026-08-20T00:05:00.000Z',
  schemaVersion: 1,
  assertionClass: 'operator_asserted',
  payload: {},
  payloadHash: HASH,
  previousHash: HASH,
  eventHash: HASH,
} as const;

const replay = {
  authoritativeProjection: {
    run,
    runAgents: [runAgent],
    roleAssignments: [],
    tasks: [],
    events: [event],
    receipts: [
      {
        id: '98479a1b-edb6-42df-b9ba-9e5b6c5f327d',
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        agentReceiptSeq: 1,
        deliveryBatchId: '5749cf4a-eb3d-4db4-9d5c-cbc2128619e9',
        sourceEventId: event.eventId,
        sourceRunSeq: 1,
        issuedEventId: 'f1f3ed34-363a-46b4-bcca-94f5ff37c8b9',
        issuedRunSeq: 2,
        viewKind: 'submission',
        resourceType: 'submission',
        resourceId: '6337add5-e197-489c-b931-09386535dfef',
        resourceVersion: '1',
        availableVirtualAt: '2026-08-20T00:05:00.000Z',
        issuedVirtualAt: '2026-08-20T00:05:00.000Z',
        issuedAt: '2026-08-20T00:05:01.000Z',
        schemaVersion: 1,
        contentSnapshot: {},
        contentHash: HASH,
        previousReceiptHash: HASH,
        receiptHash: HASH,
      },
    ],
    eligibleResources: [],
    manifest: {
      atRunSeq: 1,
      scenarioVersionHash: HASH,
      eventChainHead: HASH,
      receiptChainHeads: {},
      verified: true,
    },
  },
  bestEffortTelemetryOverlay: {
    bestEffort: true,
    gap: false,
    traces: [
      {
        traceId: '0123456789abcdef0123456789abcdef',
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        name: 'agent.sync',
        startedAt: '2026-08-20T00:05:00.000Z',
        durationMs: 42,
        status: 'OK',
        source: 'participant_exporter',
        trust: 'participant_reported',
        spanCount: 2,
      },
    ],
    coverage: {
      boundaryCoverage: 0.75,
      participantTelemetryMode: 'partial',
      droppedSpanCount: 1,
      lateSpanCount: 2,
    },
    trust: {
      platformObservedSpanCount: 3,
      participantReportedSpanCount: 2,
    },
  },
} as const;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface LiveFetchOverrides {
  readonly scenarioDetail?: unknown;
  readonly scenarioVersions?: unknown;
  readonly replay?: unknown;
}

function liveFetch(overrides: LiveFetchOverrides = {}) {
  return vi.fn<
    (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  >((input, init) => {
    void init;
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname === '/api/v2/scenarios') {
      return Promise.resolve(response({ items: [scenario] }));
    }
    if (url.pathname === `/api/v2/scenarios/${SCENARIO_ID}`) {
      return Promise.resolve(
        response(
          overrides.scenarioDetail ?? {
            scenario,
            currentVersion: scenarioVersion,
          },
        ),
      );
    }
    if (url.pathname === `/api/v2/scenarios/${SCENARIO_ID}/versions`) {
      return Promise.resolve(
        response(overrides.scenarioVersions ?? { items: [scenarioVersion] }),
      );
    }
    if (url.pathname === '/api/v2/runs') {
      return Promise.resolve(response({ items: [run] }));
    }
    if (url.pathname === `/api/v2/runs/${RUN_ID}/agents`) {
      return Promise.resolve(response({ items: [runAgent] }));
    }
    if (url.pathname === `/api/v2/runs/${RUN_ID}/replay`) {
      return Promise.resolve(response(overrides.replay ?? replay));
    }
    if (url.pathname === `/api/v2/runs/${RUN_ID}/traces`) {
      return Promise.resolve(response(replay.bestEffortTelemetryOverlay));
    }
    return Promise.resolve(response({ code: 'NOT_FOUND' }, 404));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Web read-model sources', () => {
  it('makes the committed reference projection an explicit design preview', async () => {
    const source = createReferenceReadModelSource();
    const result = await source.readScenarioCatalog();

    expect(source.mode).toBe('reference');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected reference data');
    expect(result.mode).toBe('reference');
    expect(result.data.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(result.data.runs.length).toBeGreaterThanOrEqual(3);
  });

  it('fails closed when live mode has no server-only operator token', async () => {
    const fetcher = liveFetch();
    const source = createLiveReadModelSource({
      apiOrigin: 'http://api:3001',
      operatorToken: '',
      fetcher,
    });

    const result = await source.readScenarioCatalog();

    expect(result).toMatchObject({
      status: 'unavailable',
      mode: 'live',
      reason: 'configuration',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads a dynamic Run through authenticated no-store v2 reads without inventing spans', async () => {
    const fetcher = liveFetch();
    const source = createLiveReadModelSource({
      apiOrigin: 'http://api:3001/',
      operatorToken: 'operator-secret',
      fetcher,
    });

    const result = await source.readRunWorkspace(RUN_ID);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected live data');
    expect(result.mode).toBe('live');
    expect(result.data.run.id).toBe(RUN_ID);
    expect(result.data.run.participants).toHaveLength(1);
    expect(result.data.run.spans).toEqual([]);
    expect(result.data.run.traceSummaries).toHaveLength(1);
    expect(result.data.replayByPerspective.operator).toHaveLength(2);
    expect(result.data.replayByPerspective.operator[1]).toMatchObject({
      category: 'receipt',
      visibleTo: [RUN_AGENT_ID],
    });
    expect(result.gaps.map((gap) => gap.code)).toContain(
      'SPAN_DETAIL_UNAVAILABLE',
    );

    const protectedCalls = fetcher.mock.calls.filter(([input]) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).includes('/api/v2/runs'),
    );
    expect(protectedCalls.length).toBeGreaterThanOrEqual(4);
    for (const [, init] of protectedCalls) {
      expect(init).toMatchObject({ cache: 'no-store' });
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer operator-secret',
      );
    }
  });

  it('shows a contract failure instead of silently substituting the reference fixture', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(response({ items: [{ id: 42 }] })),
    );
    const source = createLiveReadModelSource({
      apiOrigin: 'http://api:3001',
      operatorToken: 'operator-secret',
      fetcher,
    });

    const result = await source.readScenarioCatalog();

    expect(result).toMatchObject({
      status: 'unavailable',
      mode: 'live',
      reason: 'contract',
    });
    if (result.status === 'ready') throw new Error('must fail closed');
    expect(result.message).toContain('/api/v2/scenarios');
  });

  it.each([
    [
      'RunAgent',
      {
        ...replay,
        authoritativeProjection: {
          ...replay.authoritativeProjection,
          runAgents: [{ ...runAgent, runId: OTHER_RUN_ID }],
        },
      },
    ],
    [
      'Event',
      {
        ...replay,
        authoritativeProjection: {
          ...replay.authoritativeProjection,
          events: [{ ...event, runId: OTHER_RUN_ID }],
        },
      },
    ],
    [
      'Receipt',
      {
        ...replay,
        authoritativeProjection: {
          ...replay.authoritativeProjection,
          receipts: replay.authoritativeProjection.receipts.map((receipt) => ({
            ...receipt,
            runId: OTHER_RUN_ID,
          })),
        },
      },
    ],
    [
      'Trace',
      {
        ...replay,
        bestEffortTelemetryOverlay: {
          ...replay.bestEffortTelemetryOverlay,
          traces: replay.bestEffortTelemetryOverlay.traces.map((trace) => ({
            ...trace,
            runId: OTHER_RUN_ID,
          })),
        },
      },
    ],
  ])(
    'rejects a replay containing a cross-Run %s',
    async (_kind, replayValue) => {
      const source = createLiveReadModelSource({
        apiOrigin: 'http://api:3001',
        operatorToken: 'operator-secret',
        fetcher: liveFetch({ replay: replayValue }),
      });

      const result = await source.readRunWorkspace(RUN_ID);

      expect(result).toMatchObject({
        status: 'unavailable',
        mode: 'live',
        reason: 'contract',
      });
    },
  );

  it('rejects a scenario detail whose current version does not match currentVersionId', async () => {
    const source = createLiveReadModelSource({
      apiOrigin: 'http://api:3001',
      operatorToken: 'operator-secret',
      fetcher: liveFetch({
        scenarioDetail: {
          scenario,
          currentVersion: {
            ...scenarioVersion,
            id: OTHER_SCENARIO_VERSION_ID,
          },
        },
      }),
    });

    const result = await source.readScenarioWorkspace(SCENARIO_ID);

    expect(result).toMatchObject({
      status: 'unavailable',
      mode: 'live',
      reason: 'contract',
    });
  });

  it('keeps 401 failures actionable and never leaks the token in the message', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(response({ code: 'NOT_AUTHORIZED' }, 401)),
    );
    const source = createLiveReadModelSource({
      apiOrigin: 'http://api:3001',
      operatorToken: 'operator-secret',
      fetcher,
    });

    const result = await source.readRunCatalog();

    expect(result).toMatchObject({
      status: 'unavailable',
      mode: 'live',
      reason: 'authentication',
    });
    if (result.status === 'ready') throw new Error('must fail closed');
    expect(result.message).not.toContain('operator-secret');
  });
});
