#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  createHttpClientFromEnvironment,
  resolveAgentExconProtocolVersion,
} from './http-client.js';
import { createAgentExconMcpServer } from './server.js';

async function main(): Promise<void> {
  const protocolVersion = resolveAgentExconProtocolVersion();
  const http = createHttpClientFromEnvironment();
  const server = createAgentExconMcpServer(http, { protocolVersion });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(
    `WISER MCP Gateway 已通过 stdio 启动（EXCON ${protocolVersion}）。 / ` +
      `WISER MCP Gateway started over stdio (EXCON ${protocolVersion}).`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `WISER MCP Gateway 启动失败。 / WISER MCP Gateway failed to start.\n${message}`,
  );
  process.exitCode = 1;
});
