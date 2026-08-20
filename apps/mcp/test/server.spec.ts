import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentExconApiError,
  type AgentExconHttpClient,
  type AgentExconHttpRequest,
  type JsonObject,
} from '../src/http-client.js';
import {
  createAgentExconMcpServer,
  YONGDING_SCENARIO_RESOURCE_URI,
} from '../src/server.js';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_VERSION_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';

class RecordingHttpClient implements AgentExconHttpClient {
  readonly requests: AgentExconHttpRequest[] = [];
  nextError: Error | undefined;

  request(request: AgentExconHttpRequest): Promise<JsonObject> {
    this.requests.push(request);
    if (this.nextError !== undefined) {
      return Promise.reject(this.nextError);
    }
    return Promise.resolve({ requestIndex: this.requests.length });
  }
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  vi.restoreAllMocks();
});

async function connect(client: AgentExconHttpClient) {
  const server = createAgentExconMcpServer(client);
  const mcpClient = new Client({ name: 'agent-excon-test', version: '0.1.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    mcpClient.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  closeCallbacks.push(async () => {
    await Promise.all([mcpClient.close(), server.close()]);
  });

  return mcpClient;
}

describe('Agent EXCON MCP server', () => {
  it('registers the seven workflow tools with accurate annotations', async () => {
    const mcpClient = await connect(new RecordingHttpClient());

    const { tools } = await mcpClient.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      'excon_start_episode',
      'excon_get_episode',
      'excon_observe',
      'excon_submit_allocation_plan',
      'excon_get_feedback',
      'excon_advance',
      'excon_get_events',
    ]);
    expect(
      tools.find(({ name }) => name === 'excon_observe')?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(
      tools.find(({ name }) => name === 'excon_advance')?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('maps every tool to the injected HTTP client without using fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected network access'));
    const http = new RecordingHttpClient();
    const mcpClient = await connect(http);
    const plan = {
      stage: 1,
      sourceReleases: [
        {
          sourceId: 'guanting',
          flowM3s: 12.3,
          evidenceRefs: ['observation:t00-source-snapshot'],
        },
      ],
      expectedSectionFlows: [
        { sectionId: 'sanjiadian', flowM3s: 11.8 },
        { sectionId: 'lugouqiao', flowM3s: 10.7 },
        { sectionId: 'cuizhihuiying', flowM3s: 9.6 },
        { sectionId: 'qujiadian', flowM3s: 8.9 },
      ],
      isFinal: false,
    } as const;

    const results = await Promise.all([
      mcpClient.callTool({
        name: 'excon_start_episode',
        arguments: {
          scenarioVersionId: 'jjj-yongding-replenishment-2023-v1',
          participantVersionId: PARTICIPANT_VERSION_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      }),
      mcpClient.callTool({
        name: 'excon_get_episode',
        arguments: { episodeId: EPISODE_ID },
      }),
      mcpClient.callTool({
        name: 'excon_observe',
        arguments: {
          episodeId: EPISODE_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 1,
          informationIds: ['official-flow-20230322-guanting'],
        },
      }),
      mcpClient.callTool({
        name: 'excon_submit_allocation_plan',
        arguments: {
          episodeId: EPISODE_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 2,
          plan,
        },
      }),
      mcpClient.callTool({
        name: 'excon_get_feedback',
        arguments: { episodeId: EPISODE_ID },
      }),
      mcpClient.callTool({
        name: 'excon_advance',
        arguments: {
          episodeId: EPISODE_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 3,
        },
      }),
      mcpClient.callTool({
        name: 'excon_get_events',
        arguments: { episodeId: EPISODE_ID, after: 3, limit: 40 },
      }),
    ]);

    expect(results).toHaveLength(7);
    expect(
      results.every(
        ({ structuredContent }) =>
          typeof structuredContent === 'object' &&
          structuredContent !== null &&
          'ok' in structuredContent &&
          structuredContent.ok === true,
      ),
    ).toBe(true);
    expect(http.requests).toHaveLength(7);
    expect(http.requests).toEqual(
      expect.arrayContaining([
        {
          method: 'GET',
          path: `/episodes/${EPISODE_ID}`,
        },
        {
          method: 'POST',
          path: '/episodes',
          headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
          body: {
            scenarioVersionId: 'jjj-yongding-replenishment-2023-v1',
            participantVersionId: PARTICIPANT_VERSION_ID,
          },
        },
        {
          method: 'POST',
          path: `/episodes/${EPISODE_ID}/observe`,
          headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
          body: {
            episodeVersion: 1,
            informationIds: ['official-flow-20230322-guanting'],
          },
        },
        {
          method: 'POST',
          path: `/episodes/${EPISODE_ID}/submissions`,
          headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
          body: { episodeVersion: 2, plan },
        },
        {
          method: 'GET',
          path: `/episodes/${EPISODE_ID}/feedback`,
        },
        {
          method: 'POST',
          path: `/episodes/${EPISODE_ID}/advance`,
          headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
          body: { episodeVersion: 3 },
        },
        {
          method: 'GET',
          path: `/episodes/${EPISODE_ID}/events`,
          query: { after: 3, limit: 40 },
        },
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an actionable bilingual error without unsafe details', async () => {
    const http = new RecordingHttpClient();
    http.nextError = new AgentExconApiError({
      status: 409,
      payload: {
        error: {
          code: 'EPISODE_VERSION_CONFLICT',
          message: 'Episode version changed.',
          details: { hiddenRule: 'must-not-leak' },
          traceId: 'trace-12345678',
        },
      },
    });
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_advance',
      arguments: {
        episodeId: EPISODE_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        expectedVersion: 3,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'EPISODE_VERSION_CONFLICT',
        message: 'Episode version changed.',
        action:
          '请重新观察演练状态后，使用最新版本重试。 / Observe the episode again, then retry with its latest version.',
        traceId: 'trace-12345678',
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('publishes the bilingual Yongding River scenario resource locally', async () => {
    const http = new RecordingHttpClient();
    const mcpClient = await connect(http);

    const { resources } = await mcpClient.listResources();
    expect(resources).toEqual([
      expect.objectContaining({
        uri: YONGDING_SCENARIO_RESOURCE_URI,
        mimeType: 'text/markdown',
      }),
    ]);

    const result = await mcpClient.readResource({
      uri: YONGDING_SCENARIO_RESOURCE_URI,
    });
    const resource = result.contents.find((content) => 'text' in content);

    expect(resource && 'text' in resource ? resource.text : '').toContain(
      '京津冀永定河',
    );
    expect(resource && 'text' in resource ? resource.text : '').toContain(
      'Jing-Jin-Ji Yongding River',
    );
    expect(resource && 'text' in resource ? resource.text : '').toContain(
      'simulation-only',
    );
    expect(http.requests).toHaveLength(0);
  });
});
