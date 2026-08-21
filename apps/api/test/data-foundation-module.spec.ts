import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { DATA_CAPABILITY_IDS } from '@wiser/data-contracts';

import { buildApp } from '../src/app.js';
import { createDataFoundationModule } from '../src/data-foundation/plugin.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(
  readiness: () => Promise<{
    readonly database: boolean;
    readonly objectStore: boolean;
    readonly worker: boolean;
  }>,
) {
  const app = buildApp({
    modules: [createDataFoundationModule({ readiness })],
  });
  openApps.push(app);
  return app;
}

describe('Data Foundation HTTP composition module', () => {
  it('reports truthful authority readiness with non-cacheable health responses', async () => {
    const readyApp = appWith(() =>
      Promise.resolve({ database: true, objectStore: true, worker: true }),
    );
    const degradedApp = appWith(() =>
      Promise.resolve({ database: true, objectStore: false, worker: true }),
    );

    const ready = await readyApp.inject({
      method: 'GET',
      url: '/api/data/v1/health',
    });
    const degraded = await degradedApp.inject({
      method: 'GET',
      url: '/api/data/v1/health',
    });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      system: 'data-foundation',
      authority: { database: true, objectStore: true },
      worker: true,
      projections: 'rebuildable',
    });
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toMatchObject({
      status: 'degraded',
      authority: { database: true, objectStore: false },
    });
    expect(ready.headers['cache-control']).toContain('no-store');
    expect(degraded.headers['cache-control']).toContain('no-store');
  });

  it('projects the complete Zod registry into stable transport-neutral JSON contracts', async () => {
    const app = appWith(() =>
      Promise.resolve({ database: true, objectStore: true, worker: true }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/data/v1/capabilities',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      readonly registryVersion: string;
      readonly capabilities: ReadonlyArray<{
        readonly id: string;
        readonly inputSchema: Record<string, unknown>;
        readonly outputSchema: Record<string, unknown>;
        readonly restMapping: { readonly path: string };
        readonly graphqlMapping: { readonly field: string };
        readonly mcpMapping: { readonly toolName: string };
        readonly skillMapping: { readonly operation: string };
      }>;
    }>();

    expect(body.registryVersion).toBe('1.0.0');
    expect(body.capabilities.map(({ id }) => id)).toEqual(DATA_CAPABILITY_IDS);
    for (const capability of body.capabilities) {
      expect(capability.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(capability.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(capability.restMapping.path).toMatch(/^\/api\/data\/v1\//);
      expect(capability.graphqlMapping.field).not.toBe('');
      expect(capability.mcpMapping.toolName).toMatch(/^data_/);
      expect(capability.skillMapping.operation).toBe(capability.id);
    }
    expect(JSON.stringify(body)).not.toContain('inputSchema":"[object');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('keeps existing Agent EXCON routes mounted beside Data Foundation', async () => {
    const app = appWith(() =>
      Promise.resolve({ database: true, objectStore: true, worker: true }),
    );

    const excon = await app.inject({ method: 'GET', url: '/api/v2/scenarios' });
    const data = await app.inject({
      method: 'GET',
      url: '/api/data/v1/capabilities',
    });

    expect(excon.statusCode).toBe(200);
    expect(data.statusCode).toBe(200);
  });
});
