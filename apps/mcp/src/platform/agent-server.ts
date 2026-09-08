import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  PlatformAgentConnectionViewSchema,
  type PlatformAgentExchangeView,
} from '@wiser/platform-contracts';

import { FetchDataFoundationHttpClient } from '../data-foundation/http-client.js';
import { createDataFoundationMcpModule } from '../data-foundation/module.js';
import type { McpHttpRequestHandler } from '../http-server.js';

export function createAgentDataRequestHandler(
  exchange: PlatformAgentExchangeView,
  dataApiUrl: string,
  fetchImplementation: typeof fetch,
): McpHttpRequestHandler {
  const { connection } = exchange;
  const http = new FetchDataFoundationHttpClient({
    baseUrl: dataApiUrl,
    token: exchange.token,
    fetch: (url, init) =>
      fetchImplementation(url, { ...init, redirect: 'error' }),
  });
  return async (request, response) => {
    const server = new McpServer({ name: 'wiser', version: '0.1.0' });
    createDataFoundationMcpModule({
      http,
      tenantId: connection.tenantId,
      projectId: connection.projectId,
      purpose: connection.purpose,
    }).register(server);
    server.registerTool(
      'wiser_connection',
      {
        title: '当前 WISER 连接 / Current WISER connection',
        description:
          '确认当前项目与已授权能力。 / Confirm the current project and approved capabilities.',
        inputSchema: {},
        outputSchema: PlatformAgentConnectionViewSchema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      () => ({
        content: [{ type: 'text', text: JSON.stringify(connection) }],
        structuredContent: connection,
      }),
    );
    server.registerResource(
      'wiser-connection',
      'wiser://connection',
      {
        title: '当前 WISER 连接 / Current WISER connection',
        mimeType: 'application/json',
      },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(connection),
          },
        ],
      }),
    );
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response);
    } finally {
      await server.close();
    }
  };
}
