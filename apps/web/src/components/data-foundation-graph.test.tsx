// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GraphOptions } from '@antv/g6';
import { KnowledgeGraphCanvas } from './data-foundation-graph';

const engine = vi.hoisted(() => ({
  options: null as GraphOptions | null,
  render: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  resize: vi.fn(),
  draw: vi.fn().mockResolvedValue(undefined),
  updateNodeData: vi.fn(),
  updateEdgeData: vi.fn(),
  setElementState: vi.fn().mockResolvedValue(undefined),
  click: null as ((event: { target: { id: string } }) => void) | null,
}));
vi.mock('@antv/g6', () => ({
  NodeEvent: { CLICK: 'node:click' },
  Graph: class {
    constructor(options: GraphOptions) {
      engine.options = options;
    }
    on(_event: string, callback: typeof engine.click) {
      engine.click = callback;
    }
    render = engine.render;
    destroy = engine.destroy;
    resize = engine.resize;
    draw = engine.draw;
    updateNodeData = engine.updateNodeData;
    updateEdgeData = engine.updateEdgeData;
    setElementState = engine.setElementState;
  },
}));
class WorkerDouble {
  static current: WorkerDouble;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerDouble.current = this;
  }
}
class ResizeDouble {
  observe() {}
  disconnect() {}
}
const result = {
  nodes: [
    { entityId: 'a', label: 'Source' },
    { entityId: 'b', label: 'Asset' },
  ],
  edges: [{ edgeId: 'ab', fromEntityId: 'a', toEntityId: 'b' }],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('renders worker positions, preserves the canvas on selection and disposes after rendering', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  vi.stubGlobal('ResizeObserver', ResizeDouble);
  const selected = vi.fn();
  const rendered = render(
    <KnowledgeGraphCanvas
      locale="zh-CN"
      result={result}
      selectedId={null}
      onSelect={selected}
      hierarchical
    />,
  );
  await waitFor(() =>
    expect(WorkerDouble.current.postMessage).toHaveBeenCalledOnce(),
  );
  await act(async () => {
    WorkerDouble.current.onmessage?.({
      data: [
        { id: 'a', x: 12, y: 5 },
        { id: 'b', x: 52, y: 5 },
      ],
    });
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(
      screen.getByTestId('knowledge-graph').getAttribute('data-state'),
    ).toBe('ready'),
  );
  expect(engine.options?.data?.nodes?.[0].style?.x).toBe(12);
  expect(engine.options?.layout).toBeUndefined();
  expect(WorkerDouble.current.terminate).toHaveBeenCalledOnce();
  rendered.rerender(
    <KnowledgeGraphCanvas
      locale="zh-CN"
      result={result}
      selectedId="b"
      onSelect={selected}
      hierarchical
    />,
  );
  await waitFor(() =>
    expect(engine.setElementState).toHaveBeenLastCalledWith(
      { a: [], b: ['selected'] },
      false,
    ),
  );
  expect(engine.render).toHaveBeenCalledOnce();
  act(() => {
    engine.click?.({ target: { id: 'a' } });
  });
  expect(selected).toHaveBeenCalledWith('a');
  rendered.unmount();
  await waitFor(() => expect(engine.destroy).toHaveBeenCalledOnce());
});

it('cancels unfinished layout when the graph is removed', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  const rendered = render(
    <KnowledgeGraphCanvas
      locale="en"
      result={result}
      selectedId={null}
      onSelect={vi.fn()}
      hierarchical
    />,
  );
  await waitFor(() =>
    expect(WorkerDouble.current.postMessage).toHaveBeenCalledOnce(),
  );
  rendered.unmount();
  await waitFor(() =>
    expect(WorkerDouble.current.terminate).toHaveBeenCalledOnce(),
  );
  expect(engine.render).not.toHaveBeenCalled();
});
