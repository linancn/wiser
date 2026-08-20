import { createServer, type Server } from 'node:http';

import type { EvaluationWorker } from './worker.js';

export interface HealthServerOptions {
  readonly host: string;
  readonly port: number;
}

export function createHealthServer(
  worker: EvaluationWorker,
  options: HealthServerOptions,
): Server {
  const server = createServer((request, response) => {
    const health = worker.health();
    const isLiveness = request.url === '/health/live';
    const isReadiness = request.url === '/health/ready';
    if (!isLiveness && !isReadiness) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    const healthy = isLiveness ? health.live : health.ready;
    response.writeHead(healthy ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(health));
  });
  server.listen(options.port, options.host);
  return server;
}

export async function closeHealthServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
