#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpClientFromEnvironment } from './http-client.js';
import { createAgentExconMcpServer } from './server.js';

async function main(): Promise<void> {
  const http = createHttpClientFromEnvironment();
  const server = createAgentExconMcpServer(http);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(
    'Agent EXCON MCP 服务已通过 stdio 启动。 / Agent EXCON MCP server started over stdio.',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `Agent EXCON MCP 服务启动失败。 / Agent EXCON MCP server failed to start.\n${message}`,
  );
  process.exitCode = 1;
});
