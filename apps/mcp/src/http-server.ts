import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { PlatformAgentResourceSchema } from '@wiser/platform-contracts';

export type McpHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export type McpHttpRequestAuthorizer = (
  request: IncomingMessage,
) => Promise<McpHttpRequestHandler | null>;

export type WiserMcpHttpServerOptions = {
  readonly ready: () => boolean;
  readonly resourceMetadata?: {
    readonly resource: string;
    readonly authorizationServer: string;
  };
} & (
  | {
      readonly bearerToken: string;
      readonly handler: McpHttpRequestHandler;
      readonly authorize?: never;
    }
  | {
      readonly authorize: McpHttpRequestAuthorizer;
      readonly bearerToken?: never;
      readonly handler?: never;
    }
);

function noStoreHeaders() {
  return {
    'Cache-Control': 'no-store',
    Expires: '0',
    Pragma: 'no-cache',
  } as const;
}

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function validBearer(request: IncomingMessage, expected: Buffer): boolean {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === 'string'
      ? /^Bearer ([^\s]+)$/.exec(authorization)
      : null;
  if (match?.[1] === undefined) return false;
  return timingSafeEqual(tokenDigest(match[1]), expected);
}

function requestAuthorizer(
  options: WiserMcpHttpServerOptions,
): McpHttpRequestAuthorizer {
  if (options.authorize !== undefined) {
    if (options.bearerToken !== undefined || options.handler !== undefined) {
      throw new Error('MCP request authorization cannot use a shared handler.');
    }
    return options.authorize;
  }
  if (options.bearerToken.length < 16 || options.bearerToken.length > 8_192) {
    throw new Error('DATA_MCP_BEARER_TOKEN is invalid.');
  }
  const expectedToken = tokenDigest(options.bearerToken);
  return (request) =>
    Promise.resolve(
      validBearer(request, expectedToken) ? options.handler : null,
    );
}

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  challenge = 'Bearer',
): void {
  if (!response.headersSent) {
    response.writeHead(status, {
      ...noStoreHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      ...(status === 401 ? { 'WWW-Authenticate': challenge } : {}),
    });
  }
  if (!response.writableEnded) response.end(JSON.stringify({ error }));
}

export function createWiserMcpHttpServer(
  options: WiserMcpHttpServerOptions,
): Server {
  const authorize = requestAuthorizer(options);
  const metadata = options.resourceMetadata;
  if (
    metadata !== undefined &&
    (!PlatformAgentResourceSchema.safeParse(metadata.resource).success ||
      !metadata.authorizationServer.endsWith('/auth/v1') ||
      !PlatformAgentResourceSchema.safeParse(
        metadata.authorizationServer.replace(/\/auth\/v1$/, '/mcp'),
      ).success)
  )
    throw new Error('Invalid MCP OAuth resource metadata.');
  const resourceOrigin =
    metadata === undefined ? null : new URL(metadata.resource).origin;
  const challenge =
    resourceOrigin === null
      ? 'Bearer'
      : `Bearer resource_metadata="${resourceOrigin}/.well-known/oauth-protected-resource/mcp"`;

  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://mcp.invalid').pathname;
    if (
      metadata !== undefined &&
      request.method === 'GET' &&
      (path === '/.well-known/oauth-protected-resource/mcp' ||
        path === '/.well-known/oauth-protected-resource')
    ) {
      response
        .writeHead(200, {
          ...noStoreHeaders(),
          'Content-Type': 'application/json',
        })
        .end(
          JSON.stringify({
            resource: metadata.resource,
            authorization_servers: [metadata.authorizationServer],
            bearer_methods_supported: ['header'],
            scopes_supported: ['openid'],
            resource_name: 'WISER',
          }),
        );
      return;
    }
    if (request.method === 'GET' && path.startsWith('/health/')) {
      const ready = options.ready();
      const live = true;
      const healthy = path === '/health/live' ? live : ready;
      if (path !== '/health/live' && path !== '/health/ready') {
        response.writeHead(404, noStoreHeaders()).end();
        return;
      }
      response
        .writeHead(healthy ? 200 : 503, {
          ...noStoreHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
        })
        .end(JSON.stringify({ live, ready }));
      return;
    }
    if (path !== '/mcp') {
      response.writeHead(404, noStoreHeaders()).end();
      return;
    }
    if (
      resourceOrigin !== null &&
      request.headers.origin !== undefined &&
      request.headers.origin !== resourceOrigin
    ) {
      sendError(response, 403, 'MCP_ORIGIN_NOT_ALLOWED');
      return;
    }
    for (const [name, value] of Object.entries(noStoreHeaders())) {
      response.setHeader(name, value);
    }
    void (async () => {
      let handler: McpHttpRequestHandler | null;
      try {
        handler = await authorize(request);
      } catch {
        sendError(response, 503, 'MCP_AUTHORIZATION_UNAVAILABLE');
        return;
      }
      if (handler === null) {
        sendError(response, 401, 'NOT_AUTHENTICATED', challenge);
        return;
      }
      if (response.destroyed || response.writableEnded) return;
      try {
        await handler(request, response);
      } catch {
        sendError(response, 500, 'MCP_TRANSPORT_ERROR');
      }
    })();
  });
}

export function closeWiserMcpHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
