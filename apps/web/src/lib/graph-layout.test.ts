import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeGraphLayout } from './graph-layout-engine';
import { layoutGraph } from './graph-layout';
import { validGraphPositions } from './graph-layout-types';

const input = {
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ id: 'ab', source: 'a', target: 'b' }],
};
class WorkerDouble {
  static current: WorkerDouble;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerDouble.current = this;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('bounded graph layout', () => {
  it('computes stable left-to-right finite positions from graph structure', async () => {
    const positions = await computeGraphLayout(input);
    expect(validGraphPositions(positions, input)).toBe(true);
    expect(positions[1].x).toBeGreaterThan(positions[0].x);
    expect(await computeGraphLayout(input)).toEqual(positions);
    expect(await computeGraphLayout({ nodes: [], edges: [] })).toEqual([]);
  });
  it('rejects dangling edges, duplicate nodes and oversized input', async () => {
    await expect(
      computeGraphLayout({ ...input, nodes: [{ id: 'a' }] }),
    ).rejects.toThrow('Invalid bounded');
    await expect(
      computeGraphLayout({ ...input, nodes: [{ id: 'a' }, { id: 'a' }] }),
    ).rejects.toThrow('Invalid bounded');
    await expect(
      computeGraphLayout({
        nodes: Array.from({ length: 5001 }, (_, i) => ({ id: String(i) })),
        edges: [],
      }),
    ).rejects.toThrow('Invalid bounded');
  });
  it.each([
    null,
    [{ id: 'a', x: 1, y: 2 }],
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'a', x: 1, y: 2 },
    ],
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: Infinity, y: 2 },
    ],
  ])('rejects malformed worker positions %#', (value) => {
    expect(validGraphPositions(value, input)).toBe(false);
  });
  it('releases the worker after a valid response', async () => {
    vi.stubGlobal('Worker', WorkerDouble);
    const pending = layoutGraph(input, new AbortController().signal);
    const value = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 2 },
    ];
    WorkerDouble.current.onmessage?.({ data: value });
    await expect(pending).resolves.toEqual(value);
    expect(WorkerDouble.current.terminate).toHaveBeenCalledOnce();
  });
  it.each(['abort', 'error', 'messageerror', 'invalid', 'timeout'] as const)(
    'rejects and releases on %s without synchronous fallback',
    async (failure) => {
      vi.useFakeTimers();
      vi.stubGlobal('Worker', WorkerDouble);
      const controller = new AbortController();
      const pending = layoutGraph(input, controller.signal);
      const expected = expect(pending).rejects.toThrow();
      if (failure === 'abort') controller.abort();
      else if (failure === 'error') WorkerDouble.current.onerror?.();
      else if (failure === 'messageerror')
        WorkerDouble.current.onmessageerror?.();
      else if (failure === 'invalid')
        WorkerDouble.current.onmessage?.({ data: null });
      else await vi.advanceTimersByTimeAsync(10000);
      await expected;
      expect(WorkerDouble.current.terminate).toHaveBeenCalledOnce();
    },
  );
  it('does not start a worker for already cancelled work', async () => {
    await expect(layoutGraph(input, AbortSignal.abort())).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });
});

it('lays out narrow-screen provenance vertically while preserving stable identities', async () => {
  const positions = await computeGraphLayout({ ...input, direction: 'TB' });
  expect(validGraphPositions(positions, input)).toBe(true);
  expect(positions[1].y).toBeGreaterThan(positions[0].y);
  expect(positions[1].x).toBe(positions[0].x);
});
