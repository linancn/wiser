import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { InMemoryV2ExerciseService } from '../src/v2-in-memory-service.js';
import {
  createV2RuntimeFromEnvironment,
  loadV2RuntimeConfig,
  type V2RuntimeFactories,
} from '../src/v2-runtime.js';

const DATABASE_URL =
  'postgresql://wiser_excon_runtime:local-secret@supabase-db:5432/postgres';
const LEASE_KEY = Buffer.alloc(32, 7).toString('base64url');
const LEASE_KEYS = JSON.stringify({
  activeKeyId: 'primary-2026-08',
  keys: { 'primary-2026-08': LEASE_KEY },
});

function postgresEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    EXCON_V2_MODE: 'postgres',
    EXCON_JOURNAL_DATABASE_URL: DATABASE_URL,
    EXCON_LEASE_HMAC_KEYS: LEASE_KEYS,
    ...overrides,
  };
}

describe('Agent EXCON v2 production runtime', () => {
  it('defaults and forces production to PostgreSQL while preserving explicit local memory mode', () => {
    expect(() => loadV2RuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'EXCON_JOURNAL_DATABASE_URL',
    );
    expect(() =>
      loadV2RuntimeConfig({
        NODE_ENV: 'production',
        EXCON_V2_MODE: 'memory',
      }),
    ).toThrow('forbidden in production');
    expect(loadV2RuntimeConfig({ NODE_ENV: 'development' })).toEqual({
      mode: 'memory',
    });
    expect(
      loadV2RuntimeConfig({
        NODE_ENV: 'development',
        EXCON_V2_MODE: 'memory',
      }),
    ).toEqual({ mode: 'memory' });
  });

  it('strictly parses a compatible HMAC keyring and a non-superuser PostgreSQL DSN', () => {
    expect(loadV2RuntimeConfig(postgresEnvironment())).toEqual({
      mode: 'postgres',
      databaseUrl: DATABASE_URL,
      leaseHmacKeyRing: {
        activeKeyId: 'primary-2026-08',
        keys: { 'primary-2026-08': LEASE_KEY },
      },
    });

    for (const environment of [
      postgresEnvironment({
        EXCON_JOURNAL_DATABASE_URL:
          'postgresql://postgres:secret@supabase-db:5432/postgres',
      }),
      postgresEnvironment({
        EXCON_LEASE_HMAC_KEYS: JSON.stringify({
          activeKeyId: 'primary-2026-08',
          keys: {
            'primary-2026-08': Buffer.alloc(31, 7).toString('base64url'),
          },
        }),
      }),
      postgresEnvironment({
        EXCON_LEASE_HMAC_KEYS: JSON.stringify({
          activeKeyId: 'primary-2026-08',
          keys: { 'primary-2026-08': LEASE_KEY },
          extra: true,
        }),
      }),
    ]) {
      expect(() => loadV2RuntimeConfig(environment)).toThrow(
        /EXCON_(JOURNAL_DATABASE_URL|LEASE_HMAC_KEYS)/,
      );
    }
  });

  it('creates the PostgreSQL journal with one bounded Pool and transfers close ownership to the service', async () => {
    const pool = {
      connect: vi.fn(() => Promise.reject(new Error('not used by fake'))),
      end: vi.fn(() => Promise.resolve()),
    };
    const service = new InMemoryV2ExerciseService();
    const close = vi.spyOn(service, 'close');
    const createPool = vi.fn(() => pool);
    const createPostgresService = vi.fn(() => Promise.resolve(service));
    const factories: V2RuntimeFactories = {
      createPool,
      createMemoryService: vi.fn(() => new InMemoryV2ExerciseService()),
      createPostgresService,
    };

    const runtime = await createV2RuntimeFromEnvironment(
      postgresEnvironment(),
      factories,
    );

    expect(runtime.mode).toBe('postgres');
    expect(createPool).toHaveBeenCalledWith({
      connectionString: DATABASE_URL,
      applicationName: 'wiser-excon-v2-journal',
      max: 1,
    });
    expect(createPostgresService).toHaveBeenCalledWith({
      pool,
      activeLeaseHmacKeyId: 'primary-2026-08',
      leaseHmacKeys: { 'primary-2026-08': LEASE_KEY },
    });

    await runtime.service.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes an allocated Pool when journal startup fails', async () => {
    const pool = {
      connect: vi.fn(() => Promise.reject(new Error('not used by fake'))),
      end: vi.fn(() => Promise.resolve()),
    };
    const factories: V2RuntimeFactories = {
      createPool: vi.fn(() => pool),
      createMemoryService: vi.fn(() => new InMemoryV2ExerciseService()),
      createPostgresService: vi.fn(() =>
        Promise.reject(new Error('journal unavailable')),
      ),
    };

    await expect(
      createV2RuntimeFromEnvironment(postgresEnvironment(), factories),
    ).rejects.toThrow('journal unavailable');
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
