import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentExconApiError,
  type AgentExconHttpClient,
  type AgentExconHttpRequest,
  type JsonObject,
} from '../src/http-client.js';
import { createAgentExconMcpServer } from '../src/server.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-8444-444444444444';
const ARTIFACT_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const SUBMISSION_ID = '66666666-6666-4666-8666-666666666666';
const FEEDBACK_GRANT_ID = '77777777-7777-4777-8777-777777777777';
const RECEIPT_ID = '88888888-8888-4888-8888-888888888888';
const IDEMPOTENCY_KEY = '99999999-9999-4999-8999-999999999999';
const HASH = `sha256:${'a'.repeat(64)}`;
const LEASE_TOKEN = `wlt_${'x'.repeat(40)}`;

class RecordingHttpClient implements AgentExconHttpClient {
  readonly requests: AgentExconHttpRequest[] = [];
  nextData: JsonObject = { accepted: true };
  nextError: Error | undefined;

  request(request: AgentExconHttpRequest): Promise<JsonObject> {
    this.requests.push(request);
    if (this.nextError !== undefined) {
      return Promise.reject(this.nextError);
    }
    return Promise.resolve(this.nextData);
  }
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function connect(client: AgentExconHttpClient): Promise<Client> {
  const server = createAgentExconMcpServer(client);
  const mcpClient = new Client({ name: 'wiser-v2-test', version: '0.1.0' });
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

describe('WISER Agent EXCON v2 MCP adapter', () => {
  it('registers the v2 multi-agent workflow by default with accurate annotations', async () => {
    const mcpClient = await connect(new RecordingHttpClient());

    const { tools } = await mcpClient.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      'excon_get_assignment',
      'excon_sync',
      'excon_wait_and_sync',
      'excon_list_tasks',
      'excon_list_messages',
      'excon_list_artifacts',
      'excon_list_submissions',
      'excon_claim_task',
      'excon_begin_task',
      'excon_heartbeat_task',
      'excon_release_task',
      'excon_submit_task_result',
      'excon_post_message',
      'excon_publish_artifact',
      'excon_publish_artifact_version',
      'excon_endorse_submission',
      'excon_get_feedback',
      'excon_get_replay_cursor',
    ]);
    expect(
      tools.find(({ name }) => name === 'excon_get_assignment')?.annotations,
    ).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(
      tools.find(({ name }) => name === 'excon_sync')?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(
      tools.find(({ name }) => name === 'excon_release_task')?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('maps the complete participant workflow to the implemented v2 HTTP routes', async () => {
    const http = new RecordingHttpClient();
    const mcpClient = await connect(http);
    const identityHeaders = { 'X-Run-Agent-Id': RUN_AGENT_ID };
    const commandHeaders = {
      ...identityHeaders,
      'Idempotency-Key': IDEMPOTENCY_KEY,
    };
    const localized = { 'zh-CN': '永定河协作', en: 'Yongding collaboration' };

    const results = await Promise.all([
      mcpClient.callTool({
        name: 'excon_get_assignment',
        arguments: { runId: RUN_ID, runAgentId: RUN_AGENT_ID },
      }),
      mcpClient.callTool({
        name: 'excon_sync',
        arguments: {
          runId: RUN_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          afterReceiptSeq: 4,
          ack: { throughReceiptSeq: 4, headHash: HASH },
          maxItems: 25,
        },
      }),
      ...(
        ['tasks', 'messages', 'artifacts', 'submissions', 'feedback'] as const
      ).map((resource) =>
        mcpClient.callTool({
          name:
            resource === 'feedback'
              ? 'excon_get_feedback'
              : `excon_list_${resource}`,
          arguments: { runId: RUN_ID, runAgentId: RUN_AGENT_ID },
        }),
      ),
      mcpClient.callTool({
        name: 'excon_claim_task',
        arguments: {
          taskId: TASK_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 1,
          leaseSeconds: 90,
        },
      }),
      mcpClient.callTool({
        name: 'excon_begin_task',
        arguments: {
          taskId: TASK_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 2,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
        },
      }),
      mcpClient.callTool({
        name: 'excon_heartbeat_task',
        arguments: {
          taskId: TASK_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
          extendBySeconds: 30,
        },
      }),
      mcpClient.callTool({
        name: 'excon_release_task',
        arguments: {
          taskId: TASK_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
        },
      }),
      mcpClient.callTool({
        name: 'excon_submit_task_result',
        arguments: {
          taskId: TASK_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
          submissionType: 'water-allocation',
          targetScope: 'individual',
          payload: { conclusion: 'simulation-only' },
          receiptRefs: [{ receiptId: RECEIPT_ID, receiptHash: HASH }],
          artifactVersionRefs: [],
          endorsementRecipientRunAgentIds: [],
        },
      }),
      mcpClient.callTool({
        name: 'excon_post_message',
        arguments: {
          runId: RUN_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          recipientRunAgentIds: [RUN_AGENT_ID],
          subject: localized,
          body: localized,
        },
      }),
      mcpClient.callTool({
        name: 'excon_publish_artifact',
        arguments: {
          runId: RUN_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          artifactKey: 'water-evidence-output',
          artifactType: 'water-evidence',
          title: localized,
          content: { simulationOnly: true },
          recipientRunAgentIds: [RUN_AGENT_ID],
        },
      }),
      mcpClient.callTool({
        name: 'excon_publish_artifact_version',
        arguments: {
          artifactId: ARTIFACT_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          baseVersionId: ARTIFACT_VERSION_ID,
          content: { simulationOnly: true, revision: 2 },
          recipientRunAgentIds: [RUN_AGENT_ID],
        },
      }),
      mcpClient.callTool({
        name: 'excon_endorse_submission',
        arguments: {
          submissionId: SUBMISSION_ID,
          runAgentId: RUN_AGENT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          feedbackActionGrantId: FEEDBACK_GRANT_ID,
        },
      }),
      mcpClient.callTool({
        name: 'excon_get_replay_cursor',
        arguments: {
          runId: RUN_ID,
          runAgentId: RUN_AGENT_ID,
          atRunSeq: 42,
          deliverySemantics: 'acknowledged',
        },
      }),
    ]);

    expect(results).toHaveLength(17);
    expect(
      results.every(
        ({ structuredContent }) =>
          typeof structuredContent === 'object' &&
          structuredContent !== null &&
          'ok' in structuredContent &&
          structuredContent.ok === true,
      ),
    ).toBe(true);
    expect(http.requests).toEqual([
      {
        method: 'GET',
        path: `/runs/${RUN_ID}/me`,
        headers: identityHeaders,
      },
      {
        method: 'POST',
        path: `/runs/${RUN_ID}/sync`,
        headers: commandHeaders,
        body: {
          afterReceiptSeq: 4,
          ack: { throughReceiptSeq: 4, headHash: HASH },
          maxItems: 25,
        },
      },
      ...(
        ['tasks', 'messages', 'artifacts', 'submissions', 'feedback'] as const
      ).map((resource) => ({
        method: 'GET' as const,
        path: `/runs/${RUN_ID}/${resource}`,
        headers: identityHeaders,
      })),
      {
        method: 'POST',
        path: `/tasks/${TASK_ID}:claim`,
        headers: commandHeaders,
        body: { expectedVersion: 1, leaseSeconds: 90 },
      },
      {
        method: 'POST',
        path: `/tasks/${TASK_ID}:begin`,
        headers: commandHeaders,
        body: {
          expectedVersion: 2,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
        },
      },
      {
        method: 'POST',
        path: `/tasks/${TASK_ID}:heartbeat`,
        headers: commandHeaders,
        body: {
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
          extendBySeconds: 30,
        },
      },
      {
        method: 'POST',
        path: `/tasks/${TASK_ID}:release`,
        headers: commandHeaders,
        body: {
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
        },
      },
      {
        method: 'POST',
        path: `/tasks/${TASK_ID}/submissions`,
        headers: commandHeaders,
        body: {
          expectedVersion: 3,
          claimEpoch: 1,
          leaseToken: LEASE_TOKEN,
          submissionType: 'water-allocation',
          targetScope: 'individual',
          payload: { conclusion: 'simulation-only' },
          receiptRefs: [{ receiptId: RECEIPT_ID, receiptHash: HASH }],
          artifactVersionRefs: [],
          endorsementRecipientRunAgentIds: [],
        },
      },
      {
        method: 'POST',
        path: `/runs/${RUN_ID}/messages`,
        headers: commandHeaders,
        body: {
          recipientRunAgentIds: [RUN_AGENT_ID],
          subject: localized,
          body: localized,
        },
      },
      {
        method: 'POST',
        path: `/runs/${RUN_ID}/artifacts`,
        headers: commandHeaders,
        body: {
          artifactKey: 'water-evidence-output',
          artifactType: 'water-evidence',
          title: localized,
          content: { simulationOnly: true },
          recipientRunAgentIds: [RUN_AGENT_ID],
        },
      },
      {
        method: 'POST',
        path: `/artifacts/${ARTIFACT_ID}/versions`,
        headers: commandHeaders,
        body: {
          baseVersionId: ARTIFACT_VERSION_ID,
          content: { simulationOnly: true, revision: 2 },
          recipientRunAgentIds: [RUN_AGENT_ID],
        },
      },
      {
        method: 'POST',
        path: `/submissions/${SUBMISSION_ID}/endorsements`,
        headers: commandHeaders,
        body: { feedbackActionGrantId: FEEDBACK_GRANT_ID },
      },
      {
        method: 'GET',
        path: `/runs/${RUN_ID}/replay`,
        headers: identityHeaders,
        query: {
          perspective: 'agent',
          subjectId: RUN_AGENT_ID,
          atRunSeq: 42,
          deliverySemantics: 'acknowledged',
        },
      },
    ]);
  });

  it('mirrors successful structured machine data into text-only client content', async () => {
    const http = new RecordingHttpClient();
    http.nextData = {
      throughReceiptSeq: 4,
      receiptHeadHash: HASH,
      receipts: [{ resourceType: 'task', resourceId: TASK_ID }],
    };
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_sync',
      arguments: {
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        afterReceiptSeq: 0,
        maxItems: 25,
      },
    });

    const text = (
      result.content as readonly {
        readonly type: string;
        readonly text?: string;
      }[]
    ).find((block) => block.type === 'text')?.text;
    expect(text).toContain('MACHINE_DATA:');
    expect(text).toContain('"throughReceiptSeq":4');
    expect(text).toContain(`"resourceId":"${TASK_ID}"`);
    expect(result.structuredContent).toEqual({ ok: true, data: http.nextData });
  });

  it('waits before issuing one ordinary idempotent sync request', async () => {
    const http = new RecordingHttpClient();
    const mcpClient = await connect(http);
    vi.useFakeTimers();

    const pending = mcpClient.callTool({
      name: 'excon_wait_and_sync',
      arguments: {
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        afterReceiptSeq: 4,
        ack: { throughReceiptSeq: 4, headHash: HASH },
        maxItems: 25,
        waitSeconds: 15,
      },
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(http.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.structuredContent).toEqual({
      ok: true,
      data: { accepted: true },
    });
    expect(http.requests).toEqual([
      {
        method: 'POST',
        path: `/runs/${RUN_ID}/sync`,
        headers: {
          'X-Run-Agent-Id': RUN_AGENT_ID,
          'Idempotency-Key': IDEMPOTENCY_KEY,
        },
        body: {
          afterReceiptSeq: 4,
          ack: { throughReceiptSeq: 4, headHash: HASH },
          maxItems: 25,
        },
      },
    ]);
  });

  it('rejects extra tool arguments before HTTP dispatch', async () => {
    const http = new RecordingHttpClient();
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_get_assignment',
      arguments: {
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        token: 'must-not-be-accepted',
      },
    });

    expect(result.isError).toBe(true);
    expect(http.requests).toHaveLength(0);
  });

  it('returns participant-safe actionable v2 errors without API details', async () => {
    const http = new RecordingHttpClient();
    http.nextError = new AgentExconApiError({
      status: 409,
      payload: {
        error: {
          code: 'TASK_LEASE_STALE',
          message: 'Lease fencing rejected the command.',
          details: { leaseTokenHash: 'must-not-leak' },
          traceId: 'trace-v2-lease-stale',
        },
      },
    });
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_begin_task',
      arguments: {
        taskId: TASK_ID,
        runAgentId: RUN_AGENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: LEASE_TOKEN,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'TASK_LEASE_STALE',
        message: 'Lease fencing rejected the command.',
        action:
          '丢弃该租约和由它派生的写操作，重新列出 Task 并仅在 READY 时重新领取。 / Discard this lease and writes derived from it; list Tasks again and reclaim only when READY.',
        traceId: 'trace-v2-lease-stale',
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('treats a forbidden perspective as an identity boundary, not a token-scope retry', async () => {
    const http = new RecordingHttpClient();
    http.nextError = new AgentExconApiError({
      status: 403,
      payload: {
        error: {
          code: 'FORBIDDEN',
          message: 'The requested RunAgent perspective is not permitted.',
          details: { authorizedRunAgentId: 'must-not-leak' },
          traceId: 'trace-v2-forbidden',
        },
      },
    });
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_get_replay_cursor',
      arguments: {
        runId: RUN_ID,
        runAgentId: RUN_AGENT_ID,
        deliverySemantics: 'issued',
      },
    });

    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'The requested RunAgent perspective is not permitted.',
        action:
          '停止并核对可信启动身份；不要尝试其他智能体、视角或协议。 / Stop and reconcile the trusted bootstrap identity; do not try another agent, perspective, or protocol.',
        traceId: 'trace-v2-forbidden',
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('bounds oversized API responses with a recovery action', async () => {
    const http = new RecordingHttpClient();
    http.nextData = { oversized: 'x'.repeat(40_000) };
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_get_assignment',
      arguments: { runId: RUN_ID, runAgentId: RUN_AGENT_ID },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'MCP_RESPONSE_TOO_LARGE',
        message:
          '响应超过 MCP 安全上限。 / The response exceeds the MCP safety limit.',
        action:
          '请缩小 sync maxItems，或使用更窄的回放游标后重试。 / Reduce sync maxItems or retry with a narrower replay cursor.',
      },
    });
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });

  it('bounds oversized Submission recovery without returning a partial revision', async () => {
    const http = new RecordingHttpClient();
    http.nextData = {
      items: [{ id: SUBMISSION_ID, payload: 'x'.repeat(40_000) }],
    };
    const mcpClient = await connect(http);

    const result = await mcpClient.callTool({
      name: 'excon_list_submissions',
      arguments: { runId: RUN_ID, runAgentId: RUN_AGENT_ID },
    });

    expect(http.requests).toEqual([
      {
        method: 'GET',
        path: `/runs/${RUN_ID}/submissions`,
        headers: { 'X-Run-Agent-Id': RUN_AGENT_ID },
      },
    ]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'MCP_RESPONSE_TOO_LARGE' },
    });
    expect(JSON.stringify(result)).not.toContain(SUBMISSION_ID);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });

  it('publishes v2-only Yongding multi-agent workflow guidance', async () => {
    const mcpClient = await connect(new RecordingHttpClient());

    const result = await mcpClient.readResource({
      uri: 'excon://scenarios/jing-jin-ji-yongding-river',
    });
    const resource = result.contents.find((content) => 'text' in content);
    const markdown = resource && 'text' in resource ? resource.text : '';

    expect(markdown).toContain('excon_get_assignment');
    expect(markdown).not.toContain('excon_start_episode');
  });
});
