import {
  ExplorationQueryInputSchema,
  ExplorationResultSchema,
} from '@wiser/data-contracts';
import { expect, test, type Page } from '@playwright/test';
import { loadLiveCredentials } from './support/live-fixture';

const credentials = loadLiveCredentials();
const hydroAtlasId = 'e90d54eb-4740-4f21-a85e-1d497cc2cc57';

test.skip(
  process.env['WISER_DATA_REAL_CASE'] !== '1',
  'Requires the admitted private water research case.',
);

test('large original Shapefile records use byte-bounded pages with contiguous cursors', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  const versionId = '29f117aa-d1fb-5d17-9af9-d27dfd5e8367';
  const response = await page.request.post('/api/data-foundation/explore', {
    data: {
      spec: {
        versions: [
          { dataItemId: 'c3be43c7-65c8-4e5e-aaa9-fc9707cb60ae', versionId },
        ],
      },
      view: 'resources',
    },
  });
  expect(response.status()).toBe(200);
  const query = ExplorationResultSchema.parse(await response.json());
  let after: string | undefined;
  let previous = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const recordsResponse = await page.request.post(
      '/api/data-foundation/explore',
      {
        data: {
          queryId: query.queryId,
          view: 'records',
          versionId,
          assetId: 'f666ce4b-3854-4be7-a250-ef3aa5a33454',
          first: 200,
          after,
        },
      },
    );
    expect(recordsResponse.status()).toBe(200);
    expect((await recordsResponse.body()).byteLength).toBeLessThanOrEqual(
      3 * 1024 * 1024,
    );
    const result = ExplorationResultSchema.parse(await recordsResponse.json());
    expect(result.totalCount).toBe(3955);
    expect(result.records!.length).toBeGreaterThan(0);
    for (const record of result.records!) {
      expect(record.index).toBe(previous + 1);
      previous = record.index;
    }
    expect(result.nextCursor).toBeTruthy();
    after = result.nextCursor;
  }
});

test('source statistics aggregate the real station and drill into the same filtered records', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await page.getByRole('tab', { name: '统计', exact: true }).click();
  const statistics = page.getByTestId('explorer-aggregate');
  await expect(statistics.getByLabel('来源文件')).toContainText('DS-0558');
  await statistics.getByLabel('分组字段').selectOption('c1');
  await statistics.getByLabel('统计方式').selectOption('mean');
  await statistics
    .getByRole('combobox', { name: '数值字段', exact: true })
    .selectOption('c6');
  const completed = page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/data-foundation/explore')) return false;
    const body: unknown = response.request().postDataJSON();
    return (
      typeof body === 'object' &&
      body !== null &&
      'view' in body &&
      body.view === 'aggregate'
    );
  });
  await statistics.getByRole('button', { name: '计算统计' }).click();
  const response = await completed;
  expect(response.status()).toBe(200);
  const result = ExplorationResultSchema.parse(await response.json());
  expect(result.totalCount).toBe(1);
  expect(Number(result.aggregate?.groups[0]?.value)).toBe(4512772);
  await expect(page.getByTestId('explorer-aggregate-chart')).toHaveAttribute(
    'data-state',
    'ready',
  );
  await statistics
    .getByRole('button', { name: '查看分组 USGS-01646500' })
    .click();
  await expect(
    page.getByRole('tab', { name: '记录', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explorer-records')).toContainText(
    'USGS-01646500',
  );
  await expect(page.getByLabel('值', { exact: true })).toHaveValue(
    'USGS-01646500',
  );
});

test('record controls filter the real station across views and restore configuration after reload', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await expect(page.getByTestId('explorer-records')).toContainText(
    'USGS-01646500',
  );
  await page.getByText('记录条件', { exact: true }).click();
  await page.getByRole('button', { name: '添加条件', exact: true }).click();
  await page.getByLabel('值', { exact: true }).fill('USGS-01646500');
  const previous = await page
    .getByTestId('data-explorer')
    .getAttribute('data-query-id');
  await page.getByRole('button', { name: '应用到所有视图' }).click();
  await expect(page.getByTestId('data-explorer')).not.toHaveAttribute(
    'data-query-id',
    previous!,
  );
  await expect(page.getByTestId('explorer-records')).toContainText(
    'USGS-01646500',
  );
  const filtered = await page
    .getByTestId('data-explorer')
    .getAttribute('data-query-id');
  await page.reload();
  await expect(page.getByLabel('值', { exact: true })).toHaveValue(
    'USGS-01646500',
  );
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    filtered!,
  );
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect(page.getByTestId('explorer-map')).toContainText('可上图记录 1');
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page.getByLabel('值', { exact: true }).fill('missing-station');
  await page.getByRole('button', { name: '应用到所有视图' }).click();
  await expect(page.getByTestId('explorer-records')).not.toContainText(
    'USGS-01646500',
  );
  await expect(
    page.getByTestId('explorer-records').getByRole('row'),
  ).toHaveCount(1);
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toContainText('可上图记录 0');
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '清除记录条件' }).click();
  await expect(page.getByTestId('explorer-records')).toContainText(
    'USGS-01646500',
  );
});

test('large real asset numeric filtering and sorting fits the interactive request budget', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  const versionId = 'e139f0d1-972f-5401-bd35-71d842142185';
  const response = await page.request.post('/api/data-foundation/explore', {
    data: {
      spec: {
        versions: [
          { dataItemId: 'e9087b50-2094-4a68-9032-d4d56e35952e', versionId },
        ],
        recordQuery: {
          assetId: 'c3697270-8a1b-4392-9781-25f0de8032ed',
          filters: [
            { field: 'c3', type: 'number', operator: 'gte', value: 20 },
          ],
          sort: { field: 'c3', type: 'number', direction: 'desc' },
          columns: ['c1', 'c2', 'c3'],
        },
      },
      view: 'resources',
    },
  });
  expect(response.ok()).toBe(true);
  const query = ExplorationResultSchema.parse(await response.json());
  const elapsed: number[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const start = performance.now();
    const pageResponse = await page.request.post(
      '/api/data-foundation/explore',
      {
        data: { queryId: query.queryId, view: 'records', versionId, first: 25 },
      },
    );
    elapsed.push(performance.now() - start);
    expect(pageResponse.ok()).toBe(true);
    const records = ExplorationResultSchema.parse(await pageResponse.json());
    expect(records.records).toHaveLength(25);
    expect(records.totalCount).toBe(360839);
    const values = records.records!.map((record) =>
      Number(record.values['c3']),
    );
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values.every((value) => value >= 20)).toBe(true);
  }
  // With three observations the nearest-rank P95 is their maximum.
  await test.info().attach('record-query-performance', {
    body: JSON.stringify({
      sourceRecords: 361379,
      matchingRecords: 360839,
      first: 25,
      sampleMs: elapsed,
      nearestRankP95Ms: Math.max(...elapsed),
      apiTransport: 'authenticated Next.js BFF',
      samples: elapsed.length,
    }),
    contentType: 'application/json',
  });
  expect(Math.max(...elapsed)).toBeLessThan(1500);
});

test('graph layouts run in a same-origin worker and release it after rendering', async ({
  page,
}) => {
  const workers: { url: string; closed: boolean }[] = [];
  page.on('worker', (worker) => {
    const entry = { url: worker.url(), closed: false };
    workers.push(entry);
    worker.on('close', () => {
      entry.closed = true;
    });
  });
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page.getByRole('tab', { name: '知识图谱', exact: true }).click();
  await expect(page.getByTestId('knowledge-graph')).toHaveAttribute(
    'data-state',
    'ready',
  );
  // Production chunk names are content hashes, so observe Worker lifecycle itself.
  await expect.poll(() => workers.length).toBeGreaterThan(0);
  expect(
    workers.every(
      (worker) => new URL(worker.url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  await expect.poll(() => workers.every((worker) => worker.closed)).toBe(true);
});

test('query history reauthorizes conditions and restores the active view after reload', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  const explorer = page.getByTestId('data-explorer');
  const original = await explorer.getAttribute('data-query-id');
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await page.reload();
  await expect(
    page.getByRole('tab', { name: '地图', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await expect(explorer).toHaveAttribute('data-query-id', original!);
  await page.getByLabel('查询数据').fill('DS-0409');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'DS-0409 · HydroATLAS', exact: true }),
  ).toBeVisible();
  const second = await explorer.getAttribute('data-query-id');
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await page.goBack();
  await expect(explorer).toHaveAttribute('data-query-id', original!);
  await expect(page.getByLabel('查询数据')).toHaveValue('DS-0558');
  await expect(
    page.getByRole('tab', { name: '地图', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await page.goForward();
  await expect(explorer).toHaveAttribute('data-query-id', second!);
  await expect(page.getByLabel('查询数据')).toHaveValue('DS-0409');
  await expect(
    page.getByRole('button', { name: 'DS-0409 · HydroATLAS', exact: true }),
  ).toBeVisible();
});

test('expired result envelopes clear browser data at their advertised deadline', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page.route('**/api/data-foundation/explore', async (route) => {
    const response = await route.fetch();
    const result = ExplorationResultSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: { ...result, expiresAt: new Date(Date.now() + 1000).toISOString() },
    });
  });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    /^[0-9a-f-]{36}$/,
  );
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    '',
    { timeout: 5000 },
  );
  await expect(
    page.getByRole('button', { name: 'DS-0558 · NLDI API', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('data-explorer').getByRole('alert'),
  ).toContainText('本次结果集已失效');
});

test('denied query and tile responses clear previous data and allow a fresh authorized query', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '选择记录 1', exact: true }).click();
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    'USGS-01646500',
  );
  await page.route('**/api/data-foundation/explore', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: '{"error":"unavailable"}',
    }),
  );
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    '',
  );
  await expect(page.getByTestId('explorer-inspector')).not.toContainText(
    'USGS-01646500',
  );
  await expect(page.getByTestId('explorer-records')).toHaveCount(0);
  await page.unroute('**/api/data-foundation/explore');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await page.route(
    '**/api/data-foundation/geo/tiles/vector/queries/**',
    (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
      }),
  );
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    '',
  );
  await expect(page.getByTestId('explorer-map')).toHaveCount(0);
  await expect(page.getByTestId('explorer-inspector')).not.toContainText(
    '3c9220e3',
  );
});

test('statistics renders authorized whole-query counts and links a category back to resources', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  for (let index = 0; index < 3; index += 1) {
    const previousQuery = await page
      .getByTestId('data-explorer')
      .getAttribute('data-query-id');
    await page.getByRole('tab', { name: '统计', exact: true }).click();
    const chart = page.getByTestId('explorer-statistics-chart');
    await expect(chart).toHaveAttribute('data-state', 'ready');
    await expect(chart.locator('svg')).toHaveCount(1);
    await page.getByRole('button', { name: '可用 · 1', exact: true }).click();
    await expect(
      page.getByRole('tab', { name: '资源', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('explorer-total')).toContainText('1');
    await expect(page.getByTestId('data-explorer')).not.toHaveAttribute(
      'data-query-id',
      previousQuery!,
    );
  }
  await page.getByRole('tab', { name: '统计', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('explorer-statistics-chart')).toHaveAttribute(
    'data-state',
    'ready',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('real query readiness filters agree with the complete result summary', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await expect(page.getByTestId('explorer-readiness-summary')).toContainText(
    '1',
  );
  await page.getByText('更多筛选', { exact: true }).click();
  await page
    .getByRole('combobox', { name: '空间就绪状态', exact: true })
    .selectOption('NO_SPATIAL_DATA');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByTestId('explorer-total')).toContainText('0');
  await page
    .getByRole('combobox', { name: '空间就绪状态', exact: true })
    .selectOption('READY');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByTestId('explorer-total')).toContainText('1');
  await expect(page.getByTestId('explorer-readiness-summary')).toContainText(
    '已检查来源',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('real Shapefile group retains attributes and unknown CRS without fabricated map features', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=qu1_shape');
  const response = await page.request.post('/api/data-foundation/explore', {
    data: {
      spec: { dataItemIds: ['c3be43c7-65c8-4e5e-aaa9-fc9707cb60ae'] },
      view: 'resources',
    },
  });
  expect(response.status()).toBe(200);
  const query = (await response.json()) as { queryId: string };
  const result = await page.request.post('/api/data-foundation/explore', {
    data: {
      queryId: query.queryId,
      view: 'records',
      versionId: '29f117aa-d1fb-5d17-9af9-d27dfd5e8367',
      assetId: 'f666ce4b-3854-4be7-a250-ef3aa5a33454',
      first: 1,
    },
  });
  expect(result.status()).toBe(200);
  const body = (await result.json()) as {
    totalCount: number;
    coverage: { indexedRecordCount: number };
    records: { featureId: string | null; values: Record<string, unknown> }[];
    assets: { status: string; reason: string | null; paths: string[] }[];
  };
  expect(body.totalCount).toBe(3955);
  expect(body.coverage.indexedRecordCount).toBe(8628);
  expect(body.records[0]?.featureId).toBeNull();
  expect(body.records[0]?.values['__geometry']).toBeDefined();
  expect(
    body.assets
      .filter((asset) => asset.paths.some((path) => path.endsWith('.shp')))
      .map((asset) => asset.reason)
      .sort(),
  ).toEqual(['TRANSFORM_UNAVAILABLE', 'TRANSFORM_UNAVAILABLE', 'UNKNOWN_CRS']);
});

test('real large table returns an authorized bounded page within the interactive budget', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/explore?q=beijing_open_data');
  const response = await page.request.post('/api/data-foundation/explore', {
    data: {
      spec: { dataItemIds: ['e9087b50-2094-4a68-9032-d4d56e35952e'] },
      view: 'resources',
    },
  });
  expect(response.status()).toBe(200);
  const query = (await response.json()) as { queryId: string };
  const started = Date.now();
  const records = await page.request.post('/api/data-foundation/explore', {
    data: {
      queryId: query.queryId,
      view: 'records',
      versionId: 'e139f0d1-972f-5401-bd35-71d842142185',
      assetId: 'c3697270-8a1b-4392-9781-25f0de8032ed',
      first: 25,
    },
  });
  expect(records.status()).toBe(200);
  expect(Date.now() - started).toBeLessThan(1500);
  const result = (await records.json()) as {
    totalCount: number;
    records: unknown[];
    nextCursor?: string;
  };
  expect(result.totalCount).toBe(361379);
  expect(result.records).toHaveLength(25);
  expect(result.nextCursor).toBeTruthy();
});

test('real NLDI records select the same station on the exploration map', async ({
  page,
}) => {
  const tileResponses: string[] = [];
  page.on('response', (response) => {
    if (
      response.status() === 200 &&
      response.url().includes('/geo/tiles/vector/queries/')
    )
      tileResponses.push(response.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, '/zh-CN/data-foundation/explore?q=DS-0558');
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  const records = page.getByTestId('explorer-records');
  await expect(records).toContainText('USGS-01646500');
  await records
    .getByRole('button', { name: '选择记录 1', exact: true })
    .click();
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    'USGS-01646500',
  );
  await page.getByRole('tab', { name: '知识图谱', exact: true }).click();
  const graph = page.getByTestId('explorer-graph');
  await expect(graph.getByTestId('knowledge-graph')).toHaveAttribute(
    'data-state',
    'ready',
  );
  await expect(graph).toContainText('文件');
  await graph
    .getByRole('button', { name: '记录 · USGS-01646500', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    'USGS-01646500',
  );
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-selected-record',
    /^[0-9a-f-]{36}$/,
  );
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await expect.poll(() => tileResponses.length).toBeGreaterThan(0);
  const canvas = page.getByTestId('explorer-map').locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  const lookup = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/data-foundation/explore') &&
      ExplorationQueryInputSchema.safeParse(response.request().postDataJSON())
        .data?.recordId === '89baed67-b350-8e92-a713-27d8c2c6c894' &&
      response.status() === 200,
  );
  await canvas.click({
    position: { x: bounds.width / 2, y: bounds.height / 2 },
  });
  await lookup;
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    'USGS-01646500',
  );
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    '3c9220e3-a5dc-5254-b134-4cc0f6944108',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test('exploration queries real resources and preserves version selection across pagination', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, '/zh-CN/data-foundation/explore');
  await expect(
    page.getByRole('heading', { name: '数据探索', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('explorer-total')).toContainText('2,254');
  const table = page.getByTestId('explorer-results');
  expect((await table.boundingBox())!.y).toBeLessThanOrEqual(280);
  const firstQuery = await page
    .getByTestId('data-explorer')
    .getAttribute('data-query-id');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByTestId('data-explorer')).toHaveAttribute(
    'data-query-id',
    firstQuery!,
  );
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByLabel('查询数据').fill('HydroATLAS');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const item = page.getByRole('button', {
    name: 'DS-0409 · HydroATLAS',
    exact: true,
  });
  await expect(item).toBeVisible();
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    '710c54dd-26d5-54e8-a6aa-a0597ca147a8',
  );
  await expect(page.getByTestId('explorer-inspector')).toContainText(
    '仅有来源登记',
  );
  await expect(
    page
      .getByTestId('explorer-inspector')
      .getByRole('link', { name: '查看数据详情' }),
  ).toHaveAttribute('href', /version=710c54dd/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.getByLabel('查询数据').fill('no-such-resource-wiser');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByTestId('explorer-total')).toContainText('0');
  await expect(page.getByTestId('explorer-inspector')).not.toContainText(
    '710c54dd',
  );
});

async function login(page: Page, next: string) {
  await page.goto(`/zh-CN/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('邮箱').fill(credentials.email);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
}

test('real source excerpts stay within desktop and mobile viewports', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/search?q=HydroATLAS');
  await expect(page.getByRole('main')).toContainText(hydroAtlasId);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
});

test('real graph supports canvas and keyboard selection with version provenance', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, `/zh-CN/data-foundation/graph?entity=${hydroAtlasId}`);
  const graph = page.getByTestId('knowledge-graph');
  await expect(graph).toHaveAttribute('data-state', 'ready');
  await expect(graph.locator('canvas').first()).toBeVisible();
  const node = page.getByRole('button', { name: /HydroATLAS/ }).first();
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('graph-inspector')).toContainText('HydroATLAS');
  await expect(
    page.getByTestId('graph-inspector').getByRole('link'),
  ).toHaveAttribute('href', /version=710c54dd-26d5-54e8-a6aa-a0597ca147a8/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
