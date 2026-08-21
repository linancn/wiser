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
});
