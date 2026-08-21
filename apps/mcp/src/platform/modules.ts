import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface WiserMcpModule {
  readonly id: string;
  register(server: McpServer): void;
}

const moduleIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function registerWiserMcpModules(
  server: McpServer,
  modules: readonly WiserMcpModule[],
): void {
  const registeredIds = new Set<string>();
  for (const module of modules) {
    if (!moduleIdPattern.test(module.id)) {
      throw new Error(`Invalid WISER MCP module id: ${module.id}`);
    }
    if (registeredIds.has(module.id)) {
      throw new Error(`Duplicate WISER MCP module id: ${module.id}`);
    }
    registeredIds.add(module.id);
    module.register(server);
  }
}
