import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  closeDataWorkerHttpServer,
  createDataWorkerHttpServer,
  type DataWorkerStatusProvider,
} from '../src/index.js';

const servers: ReturnType<typeof createDataWorkerHttpServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeDataWorkerHttpServer));
});

describe('Data Worker operational HTTP server', () => {
  it('serves live, ready, and Prometheus endpoints without a web framework', async () => {
    const provider: DataWorkerStatusProvider = {
      health: () => ({ live: true, ready: false, phase: 'idle' }),
      prometheusMetrics: () => 'wiser_data_worker_ready 0\n',
    };
    const server = createDataWorkerHttpServer(provider);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;

    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(live.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    await expect(metrics.text()).resolves.toBe('wiser_data_worker_ready 0\n');
  });
});
