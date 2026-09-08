import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createAgentHttpAuthorizer } from '../src/platform/agent-http-authorizer.js';
import {
  createWiserMcpHttpServer,
  closeWiserMcpHttpServer,
} from '../src/http-server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

describe('Agent MCP with per-request API authorization', () => {
  it('isolates users, exposes safe connection context and uses only exchanged API credentials', async () => {
    const actors = new Map(
      ['alice', 'bob'].map((name, index) => [
        name,
        {
          connectionId: randomUUID(),
          clientId: randomUUID(),
          delegationId: randomUUID(),
          tenantId: randomUUID(),
          projectId: randomUUID(),
          scopes: ['data.catalog.read'],
          purpose: 'agent-data',
          maxSecurityLevel: 'L1_INTERNAL',
          status: 'active',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          token: `wdc1.wdc_${String(index).repeat(22)}.${String(index).repeat(43)}`,
        },
      ]),
    );
    const active = new Set(actors.keys());
    const requests: Array<{ path: string; headers: Headers }> = [];
    const apiFetch: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(init?.headers);
      if (url.pathname.endsWith('/agent-connections/exchange')) {
        const name = headers.get('authorization')?.replace('Bearer ', '') ?? '';
        const actor = actors.get(name);
        if (!active.has(name) || actor === undefined)
          return Promise.resolve(
            Response.json({ code: 'NOT_AUTHORIZED' }, { status: 403 }),
          );
        expect(headers.get('idempotency-key')).toMatch(/^[a-f0-9-]{36}$/);
        const { token, ...connection } = actor;
        return Promise.resolve(
          Response.json({
            connection,
            token,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        );
      }
      requests.push({ path: url.pathname, headers });
      return Promise.resolve(Response.json({ items: [] }));
    };
    const server = createWiserMcpHttpServer({
      ready: () => true,
      authorize: createAgentHttpAuthorizer({
        dataApiUrl: 'http://127.0.0.1:3101/api/data/v1/',
        fetch: apiFetch,
      }),
    });
    cleanups.push(() => closeWiserMcpHttpServer(server));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const clients = await Promise.all(
      ['alice', 'bob'].map(async (name) => {
        const client = new Client({ name, version: '1.0.0' });
        cleanups.push(() => client.close());
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${name}` } },
          }),
        );
        return client;
      }),
    );
    await Promise.all(
      clients.map(async (client, index) => {
        const name = index === 0 ? 'alice' : 'bob';
        const actor = actors.get(name);
        const context = await client.callTool({
          name: 'wiser_connection',
          arguments: {},
        });
        expect(context.structuredContent).toMatchObject({
          projectId: actor?.projectId,
        });
        expect(JSON.stringify(context)).not.toContain(actor?.token);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).not.toContain(
          'excon_create_episode',
        );
        await client.callTool({
          name: 'data_catalog_search',
          arguments: { query: 'water', first: 5 },
        });
      }),
    );
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const actor = [...actors.values()].find(
        (value) =>
          request.headers.get('authorization') === `Bearer ${value.token}`,
      );
      expect(actor).toBeDefined();
      expect(request.headers.get('x-wiser-project-id')).toBe(actor?.projectId);
      expect(request.headers.get('x-wiser-tenant-id')).toBe(actor?.tenantId);
      expect(request.headers.get('x-wiser-purpose')).toBe('agent-data');
    }
    active.delete('alice');
    const revoked = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer alice' },
    });
    expect(revoked.status).toBe(401);
    expect(
      (await clients[1]?.callTool({ name: 'wiser_connection', arguments: {} }))
        ?.isError,
    ).not.toBe(true);
  });
});
