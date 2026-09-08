// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorationResultSchema } from '@wiser/data-contracts';
import { DataExplorerAnalysis } from './data-explorer-analysis';

function body(init: RequestInit): unknown {
  if (typeof init.body !== 'string') throw new Error('Expected JSON request');
  return JSON.parse(init.body);
}
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = {
  recordId: id(5),
  featureId: null,
  dataItemId: id(2),
  versionId: id(3),
  analysisId: id(4),
  assetId: id(6),
  sourceId: null,
  index: 1,
  values: { c1: '0001', c2: 20 },
};
function response() {
  return ExplorationResultSchema.parse({
    queryId: id(1),
    spec: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    view: 'records',
    resources: [],
    totalCount: 26,
    selectedAssetId: id(6),
    records: [record],
    nextCursor: 'page-two',
    assets: [
      {
        assetId: id(6),
        sourceHash: 'a'.repeat(64),
        status: 'READY',
        recordCount: 26,
        featureCount: 0,
        reason: null,
        columns: [
          { key: 'c1', label: 'Station' },
          { key: 'c2', label: 'Level' },
        ],
        paths: ['source/stations.csv'],
      },
      {
        assetId: id(7),
        sourceHash: 'b'.repeat(64),
        status: 'EMPTY',
        recordCount: 0,
        featureCount: 0,
        reason: null,
        columns: [],
        paths: ['source/empty.csv'],
      },
    ],
  });
}
function props() {
  return {
    locale: 'en' as const,
    queryId: id(1),
    versionId: id(3),
    view: 'records' as const,
    selectedRecord: null,
    onSelect: vi.fn(),
    onData: vi.fn(),
    onInvalidated: vi.fn(),
    onConfigure: vi.fn(),
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('pages records, preserves original scalar values, selects a record and switches source files', async () => {
  const first = response();
  const second = {
    ...first,
    nextCursor: undefined,
    records: [
      {
        ...record,
        recordId: id(8),
        index: 26,
        values: { c1: '0026', c2: null },
      },
    ],
  };
  const empty = {
    ...first,
    totalCount: 0,
    selectedAssetId: id(7),
    nextCursor: undefined,
    records: [],
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(second))
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(empty));
  vi.stubGlobal('fetch', fetch);
  const callbacks = props();
  const user = userEvent.setup();
  render(<DataExplorerAnalysis {...callbacks} />);
  await screen.findByText('0001');
  await user.click(screen.getByRole('button', { name: 'Select record 1' }));
  expect(callbacks.onSelect).toHaveBeenCalledWith(record);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('0026');
  expect(screen.getByText('—')).toBeTruthy();
  expect(body(fetch.mock.calls[1][1] as RequestInit)).toMatchObject({
    queryId: id(1),
    after: 'page-two',
    first: 25,
  });
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await screen.findByText('0001');
  await user.selectOptions(screen.getByLabelText('Source file'), id(7));
  await waitFor(() => expect(callbacks.onData).toHaveBeenLastCalledWith(empty));
  expect(body(fetch.mock.calls[3][1] as RequestInit)).toMatchObject({
    assetId: id(7),
  });
  expect(screen.queryByText('0001')).toBeNull();
});
it('shows only the requested columns and restores a single-version query without a selected resource', async () => {
  const first = response();
  first.spec = {
    versions: [{ dataItemId: id(2), versionId: id(3) }],
    recordQuery: { assetId: id(6), filters: [], columns: ['c1'] },
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(first)));
  render(<DataExplorerAnalysis {...props()} />);
  await screen.findByText('0001');
  expect(screen.queryByRole('columnheader', { name: 'Level' })).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>('Source file').disabled).toBe(
    true,
  );
});
it('requires a selected version and forwards invalidated authorization without retaining records', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const callbacks = props();
  const rendered = render(
    <DataExplorerAnalysis {...callbacks} versionId={null} />,
  );
  expect(fetch).not.toHaveBeenCalled();
  rendered.rerender(<DataExplorerAnalysis {...callbacks} />);
  await screen.findByRole('alert');
  expect(callbacks.onInvalidated).toHaveBeenCalledWith(id(1), 403);
});
it('does not invalidate the entire query for a temporary network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  const callbacks = props();
  render(<DataExplorerAnalysis {...callbacks} />);
  await screen.findByRole('alert');
  expect(callbacks.onInvalidated).not.toHaveBeenCalled();
});
