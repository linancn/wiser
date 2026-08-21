#!/usr/bin/env node

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  createHttpClientFromEnvironment,
  resolveAgentExconProtocolVersion,
} from './http-client.js';
import { createDataFoundationMcpRuntimeFromEnvironment } from './data-foundation/http-client.js';
import {
  closeWiserMcpHttpServer,
  createWiserMcpHttpServer,
} from './http-server.js';
import { createAgentExconMcpServer } from './server.js';

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3100');
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('DATA_MCP_PORT must be an integer from 1 to 65535.');
  }
  return parsed;
}

function main(): void {
  const bearerToken = process.env['DATA_MCP_BEARER_TOKEN'];
  if (bearerToken === undefined) {
    throw new Error('DATA_MCP_BEARER_TOKEN is required.');
  }
  const protocolVersion = resolveAgentExconProtocolVersion();
  const api = createHttpClientFromEnvironment();
  const dataRuntime = createDataFoundationMcpRuntimeFromEnvironment();
  const activeRequests = new Set<Promise<void>>();
  let ready = true;
  const http = createWiserMcpHttpServer({
    bearerToken,
    ready: () => ready,
    handler(request, response) {
      const work = (async () => {
        const mcp = createAgentExconMcpServer(api, {
          protocolVersion,
          modules: dataRuntime === null ? [] : [dataRuntime.module],
        });
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        // SDK 1.x is runtime-compatible, but its optional callback types
        // predate this repository's exactOptionalPropertyTypes enforcement.
        await mcp.connect(transport as unknown as Transport);
        try {
          await transport.handleRequest(request, response);
        } finally {
          await mcp.close();
        }
      })().finally(() => {
        activeRequests.delete(work);
      });
      activeRequests.add(work);
      return work;
    },
  });
  http.listen(
    port(process.env['DATA_MCP_PORT']),
    process.env['DATA_MCP_HOST'] ?? '0.0.0.0',
  );

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    ready = false;
    await closeWiserMcpHttpServer(http);
    await Promise.all([...activeRequests]);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`WISER MCP HTTP failed to start: ${message}`);
  process.exitCode = 1;
}
