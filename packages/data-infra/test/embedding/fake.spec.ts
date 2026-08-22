import { describe, expect, it } from 'vitest';

import { DeterministicFakeEmbedding } from '../../src/embedding/index.js';

describe('deterministic fake embedding provider', () => {
  it('returns stable, bounded vectors without external state', async () => {
    const provider = new DeterministicFakeEmbedding({
      dimensions: 32,
      version: '1.0.0-fixture',
    });

    const first = await provider.embed('Yongding ecological evidence');
    const replay = await provider.embed('Yongding ecological evidence');
    const other = await provider.embed('Different evidence');

    expect(first).toEqual(replay);
    expect(first).not.toEqual(other);
    expect(first).toHaveLength(32);
    expect(first.every((value) => Number.isFinite(value))).toBe(true);
    expect(first.every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(provider.model).toEqual({
      provider: 'fake',
      model: 'sha256-expansion',
      version: '1.0.0-fixture',
      dimensions: 32,
    });
  });

  it('rejects unsafe configuration and invalid text', async () => {
    expect(
      () =>
        new DeterministicFakeEmbedding({
          dimensions: 0,
          version: '1.0.0-fixture',
        }),
    ).toThrow('dimensions');
    const provider = new DeterministicFakeEmbedding({
      dimensions: 8,
      version: '1.0.0-fixture',
    });
    expect(
      () =>
        new DeterministicFakeEmbedding({
          dimensions: 8,
          version: 'fixture-v1',
        }),
    ).toThrow('version');
    await expect(provider.embed('')).rejects.toThrow('text');
  });
});
