import { afterEach, describe, expect, it, vi } from 'vitest';

import { createExerciseClient } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('exercise API client', () => {
  it('uses a relative /api/v1 boundary', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          episode: {
            id: 'demo-session',
            scenarioVersionId: 'jjj-yongding-replenishment-2023-v1',
            state: 'feedback_available',
            virtualTime: '2023-03-22T07:00:00.000Z',
            version: 5,
          },
        }),
    });
    vi.stubGlobal('fetch', request);

    const client = createExerciseClient();
    await client.getSession('demo-session');

    expect(request).toHaveBeenCalledWith('/api/v1/episodes/demo-session', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('returns the fixture when the demo API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const client = createExerciseClient();
    await expect(client.getSession('demo-session')).resolves.toMatchObject({
      id: 'demo-session',
      source: 'fixture',
    });
  });
});
