import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import {
  createDefaultApiApp,
  type DefaultApiRuntimeFactories,
} from '../src/main.js';
import type { PlatformAuthRuntime } from '../src/platform/auth-runtime.js';
import { InMemoryV2ExerciseService } from '../src/v2-in-memory-service.js';

const ACTOR_ID = 'f1000000-0000-4000-8000-000000000001';
const TENANT_ID = 'f1000000-0000-4000-8000-000000000002';
const PROJECT_ID = 'f1000000-0000-4000-8000-000000000003';

function operatorContext(): PlatformRequestContext {
  return {
    principal: {
      actorType: 'human',
      actorId: ACTOR_ID,
      authUserId: ACTOR_ID,
      sessionId: 'f1000000-0000-4000-8000-000000000004',
      authenticationMethod: 'supabase_jwt',
    },
    authorization: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      roles: ['excon-operator'],
      scopes: ['excon.run.read'],
      purpose: 'operate',
      maxSecurityLevel: 'L2_RESTRICTED',
      authzVersion: 1,
    },
    traceId: 'f1000000000040008000000000000005',
  };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('default WISER API composition', () => {
  it('creates Platform Auth exactly once and reuses it for modules, Data, and EXCON participants', async () => {
    const resolve = vi.fn(() => Promise.resolve(operatorContext()));
    const platformAuth: PlatformAuthRuntime = {
      module: { id: 'platform.auth-runtime', register() {} },
      resolver: { resolve },
    };
    const createPlatformAuthRuntime = vi.fn(() => platformAuth);
    const createDataFoundationRuntime = vi.fn(() => ({
      enabled: false,
      modules: [],
      executors: [],
    }));
    const service = new InMemoryV2ExerciseService();
    const factories: DefaultApiRuntimeFactories = {
      createPlatformAuthRuntime,
      createDataFoundationRuntime,
      createV2Runtime: vi.fn(() =>
        Promise.resolve({ mode: 'memory' as const, service }),
      ),
    };

    const app = await createDefaultApiApp(
      {
        NODE_ENV: 'test',
        EXCON_TENANT_ID: TENANT_ID,
        EXCON_PROJECT_ID: PROJECT_ID,
        EXCON_PURPOSE: 'operate',
      },
      factories,
    );
    openApps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/manage/scenarios',
      headers: { authorization: 'Bearer shared-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(createPlatformAuthRuntime).toHaveBeenCalledOnce();
    expect(createDataFoundationRuntime).toHaveBeenCalledWith(
      expect.anything(),
      platformAuth,
    );
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('uses the local static-token fallback only when development Auth is off', async () => {
    const factories: DefaultApiRuntimeFactories = {
      createPlatformAuthRuntime: () => ({ module: null, resolver: null }),
      createDataFoundationRuntime: () => ({
        enabled: false,
        modules: [],
        executors: [],
      }),
      createV2Runtime: () =>
        Promise.resolve({
          mode: 'memory' as const,
          service: new InMemoryV2ExerciseService(),
        }),
    };
    const app = await createDefaultApiApp(
      { NODE_ENV: 'development' },
      factories,
    );
    openApps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/manage/scenarios',
      headers: { authorization: 'Bearer local-demo-operator-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a static-token fallback when non-production explicitly enables unified Auth', async () => {
    const service = new InMemoryV2ExerciseService();
    const close = vi.spyOn(service, 'close');
    const createDataFoundationRuntime = vi.fn(() => {
      throw new Error('Data composition must not be reached');
    });
    const factories: DefaultApiRuntimeFactories = {
      createPlatformAuthRuntime: () => ({ module: null, resolver: null }),
      createDataFoundationRuntime,
      createV2Runtime: () =>
        Promise.resolve({ mode: 'memory' as const, service }),
    };

    await expect(
      createDefaultApiApp(
        { NODE_ENV: 'test', WISER_AUTH_MODE: 'supabase' },
        factories,
      ),
    ).rejects.toThrow('requires unified Auth');
    expect(createDataFoundationRuntime).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the v2 journal and initialized Auth module when later composition fails', async () => {
    const service = new InMemoryV2ExerciseService();
    const closeService = vi.spyOn(service, 'close');
    const closeAuth = vi.fn(() => Promise.resolve());
    const factories: DefaultApiRuntimeFactories = {
      createV2Runtime: () =>
        Promise.resolve({ mode: 'postgres' as const, service }),
      createPlatformAuthRuntime: () => ({
        resolver: { resolve: () => Promise.resolve(operatorContext()) },
        module: {
          id: 'platform.auth-runtime',
          register(app) {
            app.addHook('onClose', closeAuth);
          },
        },
      }),
      createDataFoundationRuntime: () => {
        throw new Error('Data startup failed');
      },
    };

    await expect(
      createDefaultApiApp(
        {
          NODE_ENV: 'test',
          EXCON_TENANT_ID: TENANT_ID,
          EXCON_PROJECT_ID: PROJECT_ID,
          EXCON_PURPOSE: 'operate',
        },
        factories,
      ),
    ).rejects.toThrow('Data startup failed');
    expect(closeService).toHaveBeenCalledOnce();
    expect(closeAuth).toHaveBeenCalledOnce();
  });

  it('closes initialized Auth and journal resources when participant context validation fails', async () => {
    const service = new InMemoryV2ExerciseService();
    const closeService = vi.spyOn(service, 'close');
    const closeAuth = vi.fn(() => Promise.resolve());
    const createDataFoundationRuntime = vi.fn(() => ({
      enabled: false,
      modules: [],
      executors: [],
    }));
    const factories: DefaultApiRuntimeFactories = {
      createV2Runtime: () =>
        Promise.resolve({ mode: 'postgres' as const, service }),
      createPlatformAuthRuntime: () => ({
        resolver: { resolve: () => Promise.resolve(operatorContext()) },
        module: {
          id: 'platform.auth-runtime',
          register(app) {
            app.addHook('onClose', closeAuth);
          },
        },
      }),
      createDataFoundationRuntime,
    };

    await expect(
      createDefaultApiApp(
        {
          NODE_ENV: 'test',
          EXCON_TENANT_ID: 'not-a-uuid',
          EXCON_PROJECT_ID: PROJECT_ID,
          EXCON_PURPOSE: 'operate',
        },
        factories,
      ),
    ).rejects.toThrow('EXCON_TENANT_ID');
    expect(createDataFoundationRuntime).not.toHaveBeenCalled();
    expect(closeService).toHaveBeenCalledOnce();
    expect(closeAuth).toHaveBeenCalledOnce();
  });

  it('makes journal readiness part of the host readiness result', async () => {
    const service = new InMemoryV2ExerciseService();
    vi.spyOn(service, 'isReady').mockResolvedValue(false);
    const factories: DefaultApiRuntimeFactories = {
      createPlatformAuthRuntime: () => ({ module: null, resolver: null }),
      createDataFoundationRuntime: () => ({
        enabled: false,
        modules: [],
        executors: [],
      }),
      createV2Runtime: () =>
        Promise.resolve({ mode: 'memory' as const, service }),
    };
    const app = await createDefaultApiApp(
      { NODE_ENV: 'development' },
      factories,
    );
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', ready: false });
  });
});
