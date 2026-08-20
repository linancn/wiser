import { describe, expect, it } from 'vitest';

import { resolveV2LocalLabServerConfig } from '../src/index.js';

describe('v2 local lab server configuration', () => {
  it('requires an explicit absolute runtime directory and loopback binding', () => {
    expect(
      resolveV2LocalLabServerConfig({
        NODE_ENV: 'development',
        WISER_LAB_API_HOST: '127.0.0.1',
        WISER_LAB_API_PORT: '3101',
        WISER_LAB_RUNTIME_DIR: '/tmp/wiser-workbuddy-lab',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 3101,
      apiBaseUrl: 'http://127.0.0.1:3101/api/v2/',
      runtimeDirectory: '/tmp/wiser-workbuddy-lab',
    });
  });

  it.each([
    {
      NODE_ENV: 'production',
      WISER_LAB_RUNTIME_DIR: '/tmp/wiser-workbuddy-lab',
    },
    {
      NODE_ENV: 'development',
      WISER_LAB_API_HOST: '0.0.0.0',
      WISER_LAB_RUNTIME_DIR: '/tmp/wiser-workbuddy-lab',
    },
    {
      NODE_ENV: 'development',
      WISER_LAB_API_PORT: '0',
      WISER_LAB_RUNTIME_DIR: '/tmp/wiser-workbuddy-lab',
    },
    {
      NODE_ENV: 'development',
      WISER_LAB_RUNTIME_DIR: 'relative/runtime',
    },
    { NODE_ENV: 'development' },
  ])('rejects unsafe configuration %#', (environment) => {
    expect(() => resolveV2LocalLabServerConfig(environment)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
