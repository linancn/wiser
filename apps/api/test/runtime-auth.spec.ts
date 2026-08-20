import { describe, expect, it } from 'vitest';

import { runtimePrincipalMap } from '../src/runtime-auth.js';
import type { ExerciseServiceError } from '../src/types.js';

describe('runtime authentication configuration', () => {
  it('keeps the local v1 participant and v2 operator as distinct principals', () => {
    const principals = runtimePrincipalMap({ NODE_ENV: 'development' });

    expect(principals['local-demo-participant-token']).toMatchObject({
      id: 'local-demo-participant',
      roles: [],
    });
    expect(principals['local-demo-operator-token']).toMatchObject({
      id: 'local-demo-operator',
      roles: ['operator'],
    });
  });

  it('rejects one bearer token serving both participant and operator trust domains', () => {
    expect(() =>
      runtimePrincipalMap({
        NODE_ENV: 'development',
        AGENT_EXCON_PARTICIPANT_TOKEN: 'shared-token',
        AGENT_EXCON_OPERATOR_TOKEN: 'shared-token',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExerciseServiceError>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });

  it('requires explicit bearer tokens when the demo runtime is started in production', () => {
    expect(() => runtimePrincipalMap({ NODE_ENV: 'production' })).toThrowError(
      expect.objectContaining<Partial<ExerciseServiceError>>({
        code: 'NOT_AUTHORIZED',
      }),
    );
  });
});
