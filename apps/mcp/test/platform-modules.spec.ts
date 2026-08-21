import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type {
  AgentExconHttpClient,
  AgentExconHttpRequest,
  JsonObject,
} from '../src/http-client.js';
import type { WiserMcpModule } from '../src/platform/modules.js';
import { createAgentExconMcpServer } from '../src/server.js';

class StubHttpClient implements AgentExconHttpClient {
  request(_request: AgentExconHttpRequest): Promise<JsonObject> {
    return Promise.resolve({ ok: true });
  }
}

const testModule: WiserMcpModule = {
  id: 'test.catalog',
  register(server) {
    server.registerTool(
      'wiser_test_ping',
      {
        description: 'Static WISER module test tool.',
        inputSchema: z.strictObject({}),
      },
      () => ({ content: [{ type: 'text', text: 'pong' }] }),
    );
  },
};

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe('WISER MCP module composition', () => {
  it('adds a static module without removing Agent EXCON tools', async () => {
    const server = createAgentExconMcpServer(new StubHttpClient(), {
      modules: [testModule],
    });
    const client = new Client({ name: 'wiser-module-test', version: '0.1.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    closeCallbacks.push(async () => {
      await Promise.all([client.close(), server.close()]);
    });

    const names = (await client.listTools()).tools.map(({ name }) => name);
    expect(names).toContain('excon_get_assignment');
    expect(names).toContain('wiser_test_ping');
  });

  it('rejects duplicate module ids before connecting a transport', () => {
    expect(() =>
      createAgentExconMcpServer(new StubHttpClient(), {
        modules: [testModule, testModule],
      }),
    ).toThrow('Duplicate WISER MCP module id: test.catalog');
  });
});
