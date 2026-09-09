// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExplorationResultSchema } from '@wiser/data-contracts';
import { DataResourceContent } from './data-resource-content';
import { DataContentValue } from './data-content-value';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('preserves arbitrary text even when it happens to match a known code', () => {
  render(<DataContentValue locale="zh-CN" value="RASTER_BAND" />);
  expect(screen.getByText('RASTER_BAND')).toBeTruthy();
});

it('opens original records immediately and offers a version-bound source download', () => {
  const result = ExplorationResultSchema.parse({
    queryId: id(1),
    spec: { versions: [{ dataItemId: id(2), versionId: id(3) }] },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    view: 'records',
    resources: [],
    totalCount: 1,
    selectedAssetId: id(4),
    assets: [
      {
        assetId: id(4),
        sourceHash: 'a'.repeat(64),
        status: 'READY',
        recordCount: 1,
        featureCount: 0,
        reason: null,
        paths: ['source/stations.csv'],
        columns: [
          { key: 'identifier', label: 'identifier' },
          { key: 'name', label: 'name' },
        ],
      },
    ],
    records: [
      {
        recordId: id(5),
        featureId: null,
        dataItemId: id(2),
        versionId: id(3),
        analysisId: id(6),
        assetId: id(4),
        sourceId: null,
        index: 1,
        values: { identifier: '001234', name: 'Station One' },
      },
    ],
  });
  render(
    <DataResourceContent
      locale="zh-CN"
      dataItemId={id(2)}
      versionId={id(3)}
      assetIds={[id(4)]}
      initialResult={result}
    />,
  );
  expect(screen.getByRole('table').textContent).toContain('001234');
  expect(screen.getByRole('table').textContent).toContain('Station One');
  expect(screen.getByRole('columnheader', { name: /名称/ })).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '下载原文件' }).getAttribute('href'),
  ).toContain(`/assets/${id(3)}/${id(4)}?`);
  expect(
    screen.getByRole('link', { name: '下载原文件' }).getAttribute('href'),
  ).toContain('filename=stations.csv');
});
