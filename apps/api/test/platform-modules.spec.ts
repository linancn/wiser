import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import type { WiserApiModule } from '../src/platform/modules.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

const testModule: WiserApiModule = {
  id: 'test.catalog',
  register(app) {
    app.get('/api/test/v1/ping', () => ({ module: 'test.catalog' }));
  },
};

describe('WISER API module composition', () => {
  it('registers an explicit static module without changing EXCON routes', async () => {
    const app = buildApp({ modules: [testModule] });
    openApps.push(app);
    await app.ready();

    const moduleResponse = await app.inject({
      method: 'GET',
      url: '/api/test/v1/ping',
    });
    const exconResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/scenarios',
    });

    expect(moduleResponse.statusCode).toBe(200);
    expect(moduleResponse.json()).toEqual({ module: 'test.catalog' });
    expect(exconResponse.statusCode).toBe(200);
  });

  it('rejects duplicate module ids before serving traffic', async () => {
    const app = buildApp({ modules: [testModule, testModule] });
    openApps.push(app);

    await expect(app.ready()).rejects.toThrow(
      'Duplicate WISER API module id: test.catalog',
    );
  });
});
