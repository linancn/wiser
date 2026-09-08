import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeWiserMcpHttpServer,
  createWiserMcpHttpServer,
  type McpHttpRequestHandler,
} from '../src/http-server.js';

const servers: ReturnType<typeof createWiserMcpHttpServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeWiserMcpHttpServer));
});

async function listen(handler: McpHttpRequestHandler): Promise<{
  readonly origin: string;
  readonly handler: McpHttpRequestHandler;
}> {
  const server = createWiserMcpHttpServer({
    bearerToken: 'wdc1.local-http-test-token',
    handler,
    ready: () => true,
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, handler };
}

describe('WISER MCP Streamable HTTP boundary', () => {
  it('serves non-cacheable live and ready probes', async () => {
    const { origin } = await listen(vi.fn());

    const live = await fetch(`${origin}/health/live`);
    const ready = await fetch(`${origin}/health/ready`);

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(live.headers.get('cache-control')).toBe('no-store');
    expect(await ready.json()).toEqual({ live: true, ready: true });
  });

  it('requires the configured bearer and delegates only /mcp requests', async () => {
    const handler: McpHttpRequestHandler = vi.fn(
      (_request: IncomingMessage, response: ServerResponse) => {
        response.writeHead(202, { 'Content-Type': 'application/json' });
        response.end('{"accepted":true}');
        return Promise.resolve();
      },
    );
    const { origin } = await listen(handler);

    const missing = await fetch(`${origin}/mcp`, { method: 'POST' });
    const accepted = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wdc1.local-http-test-token' },
    });
    const unknown = await fetch(`${origin}/other`);

    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toEqual({ accepted: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(unknown.status).toBe(404);
  });

  it('binds concurrent requests to separate authorization contexts and rechecks revocation', async () => {
    const active = new Set(['alice', 'bob']);
    const server = createWiserMcpHttpServer({
      ready: () => true,
      async authorize(request: IncomingMessage) {
        const actor = request.headers.authorization?.replace('Bearer ', '');
        if (actor === undefined || !active.has(actor)) return null;
        await new Promise<void>((resolve) => setImmediate(resolve));
        return (_request: IncomingMessage, response: ServerResponse) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ actor, project: `${actor}-project` }));
          return Promise.resolve();
        };
      },
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (actor: string) =>
      fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${actor}` },
      });

    const [alice, bob] = await Promise.all([call('alice'), call('bob')]);
    expect(await alice.json()).toEqual({
      actor: 'alice',
      project: 'alice-project',
    });
    expect(await bob.json()).toEqual({ actor: 'bob', project: 'bob-project' });
    expect(alice.headers.get('cache-control')).toBe('no-store');

    active.delete('alice');
    const revoked = await call('alice');
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: 'NOT_AUTHENTICATED' });
    expect((await call('bob')).status).toBe(200);
  });

  it('keeps authorization dependency failures private and health probes available', async () => {
    const server = createWiserMcpHttpServer({
      ready: () => true,
      authorize: () =>
        Promise.reject(
          new Error('private upstream credential and database details'),
        ),
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${origin}/mcp`, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'MCP_AUTHORIZATION_UNAVAILABLE',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
  });
});
