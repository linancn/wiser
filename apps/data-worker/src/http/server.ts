import { createServer, type Server } from 'node:http';

export interface DataWorkerStatusProvider {
  health(): {
    readonly live: boolean;
    readonly ready: boolean;
    readonly phase: string;
  };
  prometheusMetrics(): string;
}

function noStoreHeaders() {
  return {
    'Cache-Control': 'no-store',
    Expires: '0',
    Pragma: 'no-cache',
  } as const;
}

export function createDataWorkerHttpServer(
  provider: DataWorkerStatusProvider,
): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://worker.invalid').pathname;
    if (request.method !== 'GET') {
      response.writeHead(405, { ...noStoreHeaders(), Allow: 'GET' }).end();
      return;
    }
    if (path === '/metrics') {
      response
        .writeHead(200, {
          ...noStoreHeaders(),
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        })
        .end(provider.prometheusMetrics());
      return;
    }
    if (path === '/health/live' || path === '/health/ready') {
      const health = provider.health();
      const healthy = path === '/health/live' ? health.live : health.ready;
      response
        .writeHead(healthy ? 200 : 503, {
          ...noStoreHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
        })
        .end(JSON.stringify(health));
      return;
    }
    response.writeHead(404, noStoreHeaders()).end();
  });
}

export function closeDataWorkerHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
