import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

export type McpHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface WiserMcpHttpServerOptions {
  readonly bearerToken: string;
  readonly handler: McpHttpRequestHandler;
  readonly ready: () => boolean;
}

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

export function createWiserMcpHttpServer(
  options: WiserMcpHttpServerOptions,
): Server {
  if (options.bearerToken.length < 16 || options.bearerToken.length > 8_192) {
    throw new Error('DATA_MCP_BEARER_TOKEN is invalid.');
  }
  const expectedToken = tokenDigest(options.bearerToken);

  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://mcp.invalid').pathname;
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
    if (!validBearer(request, expectedToken)) {
      response
        .writeHead(401, {
          ...noStoreHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
          'WWW-Authenticate': 'Bearer',
        })
        .end('{"error":"NOT_AUTHENTICATED"}');
      return;
    }
    void options.handler(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, {
          ...noStoreHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
      if (!response.writableEnded) {
        response.end('{"error":"MCP_TRANSPORT_ERROR"}');
      }
    });
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
