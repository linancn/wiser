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
  type McpHttpRequestHandler,
} from './http-server.js';
import { createAgentExconMcpServer } from './server.js';
import { createAgentMcpRuntimeFromEnvironment } from './platform/agent-http-runtime.js';

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3004');
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('DATA_MCP_PORT must be an integer from 1 to 65535.');
  }
  return parsed;
}

function staticRuntime(): {
  bearerToken: string;
  handler: McpHttpRequestHandler;
} {
  const bearerToken = process.env['DATA_MCP_BEARER_TOKEN'];
  if (bearerToken === undefined) {
    throw new Error('DATA_MCP_BEARER_TOKEN is required.');
  }
  const protocolVersion = resolveAgentExconProtocolVersion();
  const api = createHttpClientFromEnvironment();
  const dataRuntime = createDataFoundationMcpRuntimeFromEnvironment();
  return {
    bearerToken,
    async handler(request, response) {
      const mcp = createAgentExconMcpServer(api, {
        protocolVersion,
        modules: dataRuntime === null ? [] : [dataRuntime.module],
      });
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      // SDK 1.x is runtime-compatible, but its optional callback types
      // predate this repository's exactOptionalPropertyTypes enforcement.
      try {
        await mcp.connect(transport as unknown as Transport);
        await transport.handleRequest(request, response);
      } finally {
        await mcp.close();
      }
    },
  };
}

function main(): void {
  const agentRuntime = createAgentMcpRuntimeFromEnvironment(process.env);
  const activeRequests = new Set<Promise<void>>();
  let ready = true;
  const track =
    (handler: McpHttpRequestHandler): McpHttpRequestHandler =>
    (request, response) => {
      const work = handler(request, response).finally(() =>
        activeRequests.delete(work),
      );
      activeRequests.add(work);
      return work;
    };
  const options =
    agentRuntime === null
      ? (() => {
          const runtime = staticRuntime();
          return {
            bearerToken: runtime.bearerToken,
            handler: track(runtime.handler),
          };
        })()
      : {
          resourceMetadata: agentRuntime.resourceMetadata,
          async authorize(
            request: Parameters<typeof agentRuntime.authorize>[0],
          ) {
            const handler = await agentRuntime.authorize(request);
            return handler === null ? null : track(handler);
          },
        };
  const http = createWiserMcpHttpServer({ ...options, ready: () => ready });
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
