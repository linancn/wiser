// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorationViewContext } from './exploration-view-context';
import { createExplorationViewState } from '@/lib/exploration-view-state';
import { ExplorationViewSpecSchema } from '@wiser/data-contracts';
import { DataExplorerAggregate } from './data-explorer-aggregate';
vi.mock('./data-explorer-aggregate-chart', () => ({
  DataExplorerAggregateChart: () => null,
}));
const id = '10000000-0000-4000-8000-000000000001';
const base = {
  queryId: id,
  spec: {},
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
  resources: [],
  totalCount: 2,
};
const asset = {
  assetId: id,
  sourceHash: 'a'.repeat(64),
  status: 'READY',
  recordCount: 2,
  featureCount: 0,
  reason: null,
  paths: ['source.csv'],
  columns: [
    { key: 'c1', label: 'Station' },
    { key: 'c2', label: 'Level' },
  ],
};
const metadata = {
  ...base,
  view: 'records',
  records: [],
  assets: [asset],
  selectedAssetId: id,
};
const result = {
  ...base,
  view: 'aggregate',
  aggregate: {
    spec: {
      assetId: id,
      groupBy: { field: 'c2', type: 'number', interval: 0.1 },
      measure: { operation: 'count' },
    },
    groupCount: 1,
    truncated: false,
    groups: [
      {
        key: '0.2',
        upperBound: '0.3',
        unit: null,
        count: 2,
        validCount: 2,
        missingCount: 0,
        invalidCount: 0,
        value: '2',
      },
    ],
  },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requests whole-query aggregation and applies exact bucket boundaries back to shared record conditions', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal('fetch', fetch);
  const onConfigure = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerAggregate
      locale="en"
      queryId={id}
      versionId={id}
      onConfigure={onConfigure}
      onInvalidated={vi.fn()}
    />,
  );
  await screen.findByRole('option', { name: 'source.csv' });
  await user.selectOptions(screen.getByLabelText('Group field'), 'c2');
  await user.selectOptions(screen.getByLabelText('Grouping'), 'number');
  await user.clear(screen.getByLabelText('Bin width'));
  await user.type(screen.getByLabelText('Bin width'), '0.1');
  await user.click(screen.getByRole('button', { name: 'Calculate' }));
  await screen.findByRole('button', { name: 'Inspect group 0.2' });
  const init = fetch.mock.calls[1][1] as RequestInit;
  expect(typeof init.body === 'string' ? JSON.parse(init.body) : null).toEqual({
    queryId: id,
    versionId: id,
    view: 'aggregate',
    aggregate: result.aggregate.spec,
  });
  await user.click(screen.getByRole('button', { name: 'Inspect group 0.2' }));
  expect(onConfigure).toHaveBeenCalledWith({
    assetId: id,
    filters: [
      { field: 'c2', type: 'number', operator: 'gte', value: 0.2 },
      { field: 'c2', type: 'number', operator: 'lt', value: 0.3 },
    ],
  });
});
it('requires source selection and propagates authorization failures', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const onInvalidated = vi.fn();
  const props = {
    locale: 'en' as const,
    queryId: id,
    onConfigure: vi.fn(),
    onInvalidated,
  };
  const rendered = render(
    <DataExplorerAggregate {...props} versionId={null} />,
  );
  expect(fetch).not.toHaveBeenCalled();
  rendered.rerender(<DataExplorerAggregate {...props} versionId={id} />);
  await waitFor(() => expect(onInvalidated).toHaveBeenCalledWith(id, 403));
  await screen.findByRole('alert');
});
it('uses explicit calendar boundaries for accessible time-range selection', async () => {
  const temporal = {
    ...result,
    aggregate: {
      ...result.aggregate,
      spec: {
        assetId: id,
        groupBy: {
          field: 'c1',
          type: 'time',
          format: 'dmy-local',
          utcOffsetMinutes: 480,
          bucket: 'month',
        },
        measure: { operation: 'count' },
      },
      groups: [
        {
          ...result.aggregate.groups[0],
          key: '2024-01-31T16:00:00.000000Z',
          upperBound: '2024-02-29T16:00:00.000000Z',
        },
      ],
    },
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json(temporal));
  vi.stubGlobal('fetch', fetch);
  const onConfigure = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerAggregate
      locale="en"
      queryId={id}
      versionId={id}
      onConfigure={onConfigure}
      onInvalidated={vi.fn()}
    />,
  );
  await screen.findByRole('option', { name: 'source.csv' });
  await user.selectOptions(screen.getByLabelText('Group field'), 'c1');
  await user.selectOptions(screen.getByLabelText('Grouping'), 'time');
  await user.selectOptions(
    screen.getByLabelText('Source time format'),
    'dmy-local',
  );
  await user.type(screen.getByLabelText('Fixed UTC offset'), '+08:00');
  await user.selectOptions(screen.getByLabelText('Time interval'), 'month');
  await user.click(screen.getByRole('button', { name: 'Calculate' }));
  await user.click(
    await screen.findByRole('button', { name: 'Apply time range' }),
  );
  expect(onConfigure).toHaveBeenCalledWith({
    assetId: id,
    filters: [
      {
        field: 'c1',
        type: 'time',
        format: 'dmy-local',
        utcOffsetMinutes: 480,
        operator: 'gte',
        value: '2024-01-31T16:00:00.000000Z',
      },
      {
        field: 'c1',
        type: 'time',
        format: 'dmy-local',
        utcOffsetMinutes: 480,
        operator: 'lt',
        value: '2024-02-29T16:00:00.000000Z',
      },
    ],
  });
});

it('restores a saved aggregate and its exact bin width without requiring another calculation click', async () => {
  const state = createExplorationViewState(
    id,
    ExplorationViewSpecSchema.parse({
      activeView: 'statistics',
      requests: {
        statistics: {
          queryId: id,
          view: 'aggregate',
          versionId: id,
          aggregate: result.aggregate.spec,
        },
      },
    }),
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal('fetch', fetch);
  render(
    <ExplorationViewContext.Provider value={state}>
      <DataExplorerAggregate
        locale="en"
        queryId={id}
        versionId={id}
        onConfigure={vi.fn()}
        onInvalidated={vi.fn()}
      />
    </ExplorationViewContext.Provider>,
  );
  await screen.findByRole('button', { name: 'Inspect group 0.2' });
  expect(screen.getByLabelText<HTMLInputElement>('Bin width').value).toBe(
    '0.1',
  );
  expect(
    state.capture('statistics')?.requests.statistics?.aggregate?.groupBy,
  ).toEqual(result.aggregate.spec.groupBy);
});
