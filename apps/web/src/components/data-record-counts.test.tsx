// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorationResultSchema } from '@wiser/data-contracts';
import { DataExplorer } from './data-explorer';
import { DataResourceContent } from './data-resource-content';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
afterEach(cleanup);

function fixture() {
  return ExplorationResultSchema.parse({
    queryId: id(1),
    spec: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    view: 'resources',
    totalCount: 1,
    resources: [
      {
        dataItemId: id(2),
        versionId: id(3),
        name: 'Paired observations',
        provider: 'Synthetic source',
        kind: 'FILE_COLLECTION',
        assetCount: 2,
        recordCount: 4,
        featureCount: 0,
        limitations: [],
        readiness: {
          records: 'READY',
          spatial: 'NO_SPATIAL_DATA',
          graph: 'NOT_PARSED',
        },
      },
    ],
    summary: {
      resourceCount: 1,
      analyzedResourceCount: 1,
      indexedRecordCount: 4,
      indexedFeatureCount: 0,
      records: [{ status: 'READY', count: 1 }],
      spatial: [{ status: 'NO_SPATIAL_DATA', count: 1 }],
    },
    selectedAssetId: id(4),
    assets: ['csv', 'xlsx'].map((extension, index) => ({
      assetId: id(4 + index),
      sourceHash: (index ? 'b' : 'a').repeat(64),
      status: 'READY',
      recordCount: 2,
      featureCount: 0,
      reason: null,
      paths: [`source/observations.${extension}`],
      columns: [{ key: 'station', label: 'station' }],
    })),
    records: [],
  });
}

it.each([
  [
    'zh-CN',
    '解析内容记录数',
    '独立业务观测数',
    '未统计／待核验',
    /按文件累计.*格式副本.*文档片段/,
  ],
  [
    'en',
    'Parsed content records',
    'Independent business observations',
    'Not counted / pending verification',
    /per file.*format copies.*document fragments/,
  ],
] as const)(
  'distinguishes parsed counts from unknown observations in %s',
  async (locale, parsed, observations, unknown, explanation) => {
    const initial = fixture();
    render(
      <DataExplorer
        locale={locale}
        initialResult={initial}
        initialFailure={null}
        initialText=""
      />,
    );
    expect(screen.getByRole('columnheader', { name: parsed })).toBeTruthy();
    const summary = screen.getByTestId('explorer-readiness-summary');
    expect(summary.textContent).toContain(`${parsed} 4`);
    expect(screen.getByText(explanation)).toBeTruthy();
    const observationLabel = screen.getByText(observations);
    expect(observationLabel.nextElementSibling?.textContent).toBe(unknown);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Paired observations' }));
    const details = screen.getByTestId('explorer-inspector');
    expect(
      within(details).getByText(parsed).nextElementSibling?.textContent,
    ).toContain('4');
    expect(
      within(details).getByText(
        locale === 'en' ? 'Files and assets' : '文件与资产',
      ).nextElementSibling?.textContent,
    ).toBe('2');
  },
);

it.each(['zh-CN', 'en'] as const)(
  'labels a source-file count and keeps both original formats in %s',
  (locale) => {
    const initial = {
      ...fixture(),
      view: 'records' as const,
      resources: [],
      totalCount: 2,
    };
    render(
      <DataResourceContent
        locale={locale}
        dataItemId={id(2)}
        versionId={id(3)}
        assetIds={[id(4), id(5)]}
        initialResult={initial}
      />,
    );
    expect(
      screen.getByRole('button', { name: /observations.csv/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /observations.xlsx/ }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === 'en' ? 'Parsed content records: 2' : '解析内容记录数：2',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === 'en'
          ? 'Not counted / pending verification'
          : '未统计／待核验',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        locale === 'en'
          ? /per file.*format copies.*document fragments/
          : /按文件累计.*格式副本.*文档片段/,
      ),
    ).toBeTruthy();
  },
);
