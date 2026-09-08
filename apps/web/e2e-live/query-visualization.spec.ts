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
