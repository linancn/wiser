// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataExplorerStatistics } from './data-explorer-statistics';
import { DataExplorerAggregateChart } from './data-explorer-aggregate-chart';
import type {
  ExplorationAggregate,
  ExplorationSummary,
} from '@wiser/data-contracts';

const charts = vi.hoisted(() => ({
  instances: [] as {
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    click?: (event: unknown) => void;
    brush?: (event: unknown) => void;
    dispatchAction: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: () => {
    const instance = {
      setOption: vi.fn(),
      dispatchAction: vi.fn(),
      brush: undefined as ((event: unknown) => void) | undefined,
      resize: vi.fn(),
      dispose: vi.fn(),
      click: undefined as ((event: unknown) => void) | undefined,
      on: (event: string, callback: (event: unknown) => void) => {
        if (event === 'brushEnd') instance.brush = callback;
        else instance.click = callback;
      },
    };
    charts.instances.push(instance);
    return instance;
  },
}));
const resize = {
  callbacks: [] as (() => void)[],
  disconnects: [] as ReturnType<typeof vi.fn>[],
};
beforeEach(() => {
  charts.instances.length = 0;
  resize.callbacks.length = 0;
  resize.disconnects.length = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize.callbacks.push(callback);
        resize.disconnects.push(this.disconnect);
      }
      observe() {}
      disconnect = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const summary: ExplorationSummary = {
  resourceCount: 3,
  analyzedResourceCount: 2,
  indexedRecordCount: 8,
  indexedFeatureCount: 1,
  records: [
    { status: 'READY', count: 2 },
    { status: 'METADATA_ONLY', count: 1 },
  ],
  spatial: [
    { status: 'READY', count: 1 },
    { status: 'NO_SPATIAL_DATA', count: 2 },
  ],
};
it('keeps whole-query chart selection equivalent to keyboard selection and disposes old dimensions', async () => {
  const onFilter = vi.fn(),
    latest = vi.fn();
  const user = userEvent.setup();
  const rendered = render(
    <DataExplorerStatistics
      locale="en"
      summary={summary}
      onFilter={onFilter}
    />,
  );
  await user.click(screen.getByRole('button', { name: /2/ }));
  expect(onFilter).toHaveBeenCalledWith('records', 'READY');
  rendered.rerender(
    <DataExplorerStatistics locale="en" summary={summary} onFilter={latest} />,
  );
  charts.instances[0].click?.({ dataIndex: 1 });
  expect(latest).toHaveBeenCalledWith('records', 'METADATA_ONLY');
  for (const event of [null, {}, { dataIndex: '0' }, { dataIndex: 1000 }])
    charts.instances[0].click?.(event);
  expect(latest).toHaveBeenCalledTimes(1);
  await user.selectOptions(screen.getByLabelText('Dimension'), 'spatial');
  expect(charts.instances[0].dispose).toHaveBeenCalledOnce();
  charts.instances[1].click?.({ dataIndex: 0 });
  expect(latest).toHaveBeenLastCalledWith('spatial', 'READY');
  rendered.unmount();
  expect(charts.instances[1].dispose).toHaveBeenCalledOnce();
  expect(
    resize.disconnects.every(
      (disconnect) => disconnect.mock.calls.length === 1,
    ),
  ).toBe(true);
});
it('respects reduced motion and redraws semantic chart colors after theme changes', async () => {
  const rendered = render(
    <DataExplorerStatistics locale="en" summary={summary} onFilter={vi.fn()} />,
  );
  expect(charts.instances[0].setOption).toHaveBeenCalledWith(
    expect.objectContaining({ animation: false }),
    expect.anything(),
  );
  document.documentElement.setAttribute('data-theme', 'dark');
  await waitFor(() =>
    expect(charts.instances[0].setOption).toHaveBeenCalledTimes(2),
  );
  resize.callbacks[0]();
  expect(charts.instances[0].resize).toHaveBeenCalledOnce();
  rendered.unmount();
});
it('keeps exact aggregate rows for selection and omits numbers outside the chart range', async () => {
  const group = {
    key: '0001',
    upperBound: null,
    unit: null,
    count: 1,
    validCount: 1,
    missingCount: 0,
    invalidCount: 0,
    value: '1.25',
  };
  const result: ExplorationAggregate = {
    spec: {
      assetId: '10000000-0000-4000-8000-000000000001',
      measure: { operation: 'sum', field: 'c1' },
    },
    groupCount: 3,
    truncated: false,
    groups: [
      group,
      { ...group, key: null, value: null },
      { ...group, key: 'huge', value: '1e999' },
    ],
  };
  const onPick = vi.fn(),
    latest = vi.fn();
  const rendered = render(
    <DataExplorerAggregateChart locale="en" result={result} onPick={onPick} />,
  );
  expect(charts.instances[0].setOption).toHaveBeenCalledWith(
    expect.objectContaining({
      animation: false,
      series: [expect.objectContaining({ data: [1.25, null, null] })],
    }),
    expect.anything(),
  );
  charts.instances[0].click?.({ dataIndex: 0 });
  expect(onPick).toHaveBeenCalledWith(group);
  rendered.rerender(
    <DataExplorerAggregateChart locale="en" result={result} onPick={latest} />,
  );
  charts.instances[0].click?.({ dataIndex: 0 });
  expect(latest).toHaveBeenCalledWith(group);
  for (const event of [null, {}, { dataIndex: '0' }, { dataIndex: 999 }])
    charts.instances[0].click?.(event);
  expect(latest).toHaveBeenCalledTimes(1);
  document.documentElement.setAttribute('data-theme', 'light');
  await waitFor(() =>
    expect(charts.instances[0].setOption).toHaveBeenCalledTimes(2),
  );
  resize.callbacks[0]();
  expect(charts.instances[0].resize).toHaveBeenCalledOnce();
  rendered.unmount();
  expect(charts.instances[0].dispose).toHaveBeenCalledOnce();
  expect(resize.disconnects[0]).toHaveBeenCalledOnce();
});

it('separates temporal unit series and snaps a brush to exact complete calendar buckets', () => {
  const group = {
    key: '2024-01-31T16:00:00.000000Z',
    upperBound: '2024-02-29T16:00:00.000000Z',
    unit: 'm',
    count: 1,
    validCount: 1,
    missingCount: 0,
    invalidCount: 0,
    value: '1',
  };
  const result: ExplorationAggregate = {
    spec: {
      assetId: '10000000-0000-4000-8000-000000000001',
      groupBy: {
        field: 'time',
        type: 'time',
        format: 'dmy-local',
        utcOffsetMinutes: 480,
        bucket: 'month',
      },
      measure: { operation: 'mean', field: 'level', unitField: 'unit' },
    },
    groupCount: 3,
    truncated: false,
    groups: [
      group,
      { ...group, unit: 'cm', value: '100' },
      { ...group, key: null, upperBound: null },
    ],
  };
  const onPick = vi.fn(),
    onRange = vi.fn();
  render(
    <DataExplorerAggregateChart
      locale="en"
      result={result}
      onPick={onPick}
      onRange={onRange}
    />,
  );
  expect(charts.instances[0].setOption).toHaveBeenCalledWith(
    expect.objectContaining({
      xAxis: expect.objectContaining({ type: 'time' }) as unknown,
      series: [
        expect.objectContaining({ type: 'line', name: 'm' }),
        expect.objectContaining({ type: 'line', name: 'cm' }),
      ],
    }),
    expect.anything(),
  );
  charts.instances[0].brush?.({
    areas: [
      {
        coordRange: [
          Date.parse('2024-02-02T00:00:00Z'),
          Date.parse('2024-02-10T00:00:00Z'),
        ],
      },
    ],
  });
  expect(onRange).toHaveBeenCalledWith(group.key, group.key);
  charts.instances[0].click?.({ dataIndex: 0, seriesIndex: 1 });
  expect(onPick).toHaveBeenCalledWith(result.groups[1]);
  for (const event of [
    null,
    {},
    { areas: [] },
    { areas: [{ coordRange: [NaN, Infinity] }] },
  ])
    charts.instances[0].brush?.(event);
  expect(onRange).toHaveBeenCalledTimes(1);
});
