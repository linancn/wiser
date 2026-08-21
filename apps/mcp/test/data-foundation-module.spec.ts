import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentExconHttpClient,
  AgentExconHttpRequest,
  JsonObject,
} from '../src/http-client.js';
import {
  createDataFoundationMcpModule,
  type DataFoundationHttpClient,
  type DataFoundationHttpRequest,
} from '../src/data-foundation/module.js';
import { createAgentExconMcpServer } from '../src/server.js';

const TENANT_ID = 'a1000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'a1000000-0000-4000-8000-000000000002';
const DATA_ITEM_ID = 'a1000000-0000-4000-8000-000000000003';
const VERSION_ID = 'a1000000-0000-4000-8000-000000000004';
const INGESTION_ID = 'a1000000-0000-4000-8000-000000000005';
const IDEMPOTENCY_KEY = 'a1000000-0000-4000-8000-000000000006';

const EXPECTED_DATA_TOOLS = [
  'data_catalog_search',
  'data_catalog_get',
  'data_query',
  'data_search_federated',
  'data_knowledge_search',
  'data_graph_expand',
  'data_graph_find_path',
  'data_geo_query',
  'data_geo_intersect',
  'data_ingestion_create',
  'data_ingestion_submit',
  'data_operation_get',
  'data_catalog_create',
  'data_catalog_versions_list',
  'data_catalog_version_get',
  'data_upload_session_create',
  'data_upload_session_complete',
  'data_ingestion_get',
  'data_ingestion_approve',
  'data_ingestion_reject',
  'data_operation_cancel',
  'data_operation_events',
] as const;

class StubExconHttpClient implements AgentExconHttpClient {
  request(_request: AgentExconHttpRequest): Promise<JsonObject> {
    return Promise.resolve({ ok: true });
  }
}

class RecordingDataHttpClient implements DataFoundationHttpClient {
  readonly requests: DataFoundationHttpRequest[] = [];
  next: JsonObject = { items: [] };
  failure?: Error;

  request(request: DataFoundationHttpRequest): Promise<JsonObject> {
    this.requests.push(structuredClone(request));
    return this.failure === undefined
      ? Promise.resolve(this.next)
      : Promise.reject(this.failure);
  }
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function connect(dataHttp: RecordingDataHttpClient): Promise<Client> {
  const server = createAgentExconMcpServer(new StubExconHttpClient(), {
    modules: [
      createDataFoundationMcpModule({
        http: dataHttp,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'analysis',
      }),
    ],
  });
  const client = new Client({ name: 'wiser-data-test', version: '0.1.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  closeCallbacks.push(async () => {
    await Promise.all([client.close(), server.close()]);
  });
  return client;
}

describe('Data Foundation MCP module', () => {
  it('registers every static Capability mapping and no arbitrary execution tool', async () => {
    const client = await connect(new RecordingDataHttpClient());
    const names = (await client.listTools()).tools.map(({ name }) => name);

    expect(names.filter((name) => name.startsWith('data_'))).toEqual(
      EXPECTED_DATA_TOOLS,
    );
    for (const forbidden of [
      'sql_execute',
      'cypher_execute',
      'opensearch_execute',
      'shell_execute',
      'filesystem_read_anywhere',
      'database_admin',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('maps strict query and versioned command inputs only to the public HTTP API', async () => {
    const http = new RecordingDataHttpClient();
    const client = await connect(http);

    await client.callTool({
      name: 'data_catalog_search',
      arguments: { query: '永定河', first: 10 },
    });
    http.next = {
      operation: {
        operationId: 'a1000000-0000-4000-8000-000000000007',
        status: 'PENDING',
        resource:
          'operation://a1000000-0000-4000-8000-000000000007',
      },
    };
    const submitted = await client.callTool({
      name: 'data_ingestion_submit',
      arguments: {
        ingestionId: INGESTION_ID,
        expectedVersion: 4,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    expect(http.requests).toEqual([
      {
        method: 'GET',
        path: '/catalog/data-items',
        headers: {
          'X-Wiser-Tenant-Id': TENANT_ID,
          'X-Wiser-Project-Id': PROJECT_ID,
          'X-Wiser-Purpose': 'analysis',
        },
        query: { query: '永定河', first: 10 },
      },
      {
        method: 'POST',
        path: `/ingestions/${INGESTION_ID}/submit`,
        headers: {
          'X-Wiser-Tenant-Id': TENANT_ID,
          'X-Wiser-Project-Id': PROJECT_ID,
          'X-Wiser-Purpose': 'analysis',
          'Idempotency-Key': IDEMPOTENCY_KEY,
          'If-Match': '"v4"',
        },
        body: {},
      },
    ]);
    expect(submitted.structuredContent).toMatchObject({
      ok: true,
      data: {
        operation: {
          status: 'PENDING',
          resource:
            'operation://a1000000-0000-4000-8000-000000000007',
        },
      },
    });

    const before = http.requests.length;
    const rejected = await client.callTool({
      name: 'data_catalog_search',
      arguments: { query: 'x', first: 10, sql: 'select * from secrets' },
    });
    expect(rejected.isError).toBe(true);
    expect(http.requests).toHaveLength(before);
  });

  it('exposes only governed HTTP-backed resource templates', async () => {
    const http = new RecordingDataHttpClient();
    http.next = { versionId: VERSION_ID, dataItemId: DATA_ITEM_ID };
    const client = await connect(http);

    const templates = (await client.listResourceTemplates()).resourceTemplates;
    expect(templates.map(({ uriTemplate }) => uriTemplate)).toEqual([
      'data://items/{dataItemId}/versions/{versionId}',
      'evidence://fragments/{evidenceId}',
      'operation://{operationId}',
      'schema://capabilities/{capabilityId}/{version}',
      'stac://collections/{collectionId}/items/{itemId}',
    ]);

    const resource = await client.readResource({
      uri: `data://items/${DATA_ITEM_ID}/versions/${VERSION_ID}`,
    });
    expect(http.requests.at(-1)).toMatchObject({
      method: 'GET',
      path: `/catalog/data-items/${DATA_ITEM_ID}/versions/${VERSION_ID}`,
    });
    expect(resource.contents[0]?.text).toContain(VERSION_ID);
  });

  it('returns a safe MCP error without forwarding backend secrets', async () => {
    const http = new RecordingDataHttpClient();
    http.failure = new Error(
      'postgresql://admin:secret@data-postgres authority row dump',
    );
    const client = await connect(http);
    const result = await client.callTool({
      name: 'data_catalog_get',
      arguments: { dataItemId: DATA_ITEM_ID },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('postgresql');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('row dump');
  });
});
