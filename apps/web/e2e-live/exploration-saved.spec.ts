import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  CreateExplorationViewOutputSchema,
  ExportExplorationOutputSchema,
  ExplorationResultSchema,
} from '@wiser/data-contracts';
import { loadLiveCredentials } from './support/live-fixture';
const credentials = loadLiveCredentials();
test.skip(
  process.env['WISER_DATA_REAL_CASE'] !== '1',
  'Requires admitted private water research case.',
);
async function login(page: Page) {
  await page.goto(
    '/zh-CN/login?next=' +
      encodeURIComponent('/zh-CN/data-foundation/explore?q=DS-0558'),
  );
  await page.getByLabel('邮箱').fill(credentials.email);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/explore/);
}
async function save(
  page: Page,
  title: string,
  ids: string[],
  visibility = 'private',
) {
  await page.getByText('保存、分享与导出', { exact: true }).click();
  await page.getByLabel('视图名称').fill(title);
  await page
    .getByRole('combobox', { name: '可查看的人', exact: true })
    .selectOption(visibility);
  const pending = page.waitForResponse((response) =>
    response.url().endsWith('/explore/views/create'),
  );
  await page.getByRole('button', { name: '保存视图', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const saved = CreateExplorationViewOutputSchema.parse(
    await response.json(),
  ).savedView;
  ids.push(saved.viewId);
  return saved.viewId;
}
async function revoke(page: Page, ids: string[]) {
  for (const viewId of ids) {
    const response = await page.request.post(
      '/api/data-foundation/explore/views/revoke',
      { headers: { 'Idempotency-Key': randomUUID() }, data: { viewId } },
    );
    expect(response.ok(), `Revoke returned ${response.status()}`).toBe(true);
  }
}
test('saved graph restores exact source selection and map layers; project link remains revocable', async ({
  page,
}) => {
  test.setTimeout(90000);
  const ids: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  try {
    await page
      .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
      .click();
    await page.getByRole('tab', { name: '记录', exact: true }).click();
    await page.getByRole('button', { name: '选择记录 1', exact: true }).click();
    await page.getByRole('tab', { name: '地图', exact: true }).click();
    await expect(page.getByTestId('explorer-map')).toHaveAttribute(
      'data-ready',
      'true',
    );
    await page.getByText('图层与图例', { exact: true }).click();
    await page.getByRole('checkbox', { name: '线', exact: true }).uncheck();
    await page.getByRole('tab', { name: '知识图谱', exact: true }).click();
    await expect(page.getByTestId('knowledge-graph')).toHaveAttribute(
      'data-state',
      'ready',
    );
    const before = await page
      .getByTestId('data-explorer')
      .getAttribute('data-query-id');
    const viewId = await save(page, 'NLDI retained views', ids, 'project');
    await page
      .getByRole('link', { name: 'NLDI retained views', exact: true })
      .click();
    await expect(
      page.getByRole('tab', { name: '知识图谱', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('knowledge-graph')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await expect(page.getByTestId('data-explorer')).not.toHaveAttribute(
      'data-query-id',
      before!,
    );
    await expect(page.getByTestId('explorer-inspector')).toContainText(
      'USGS-01646500',
    );
    await page.reload();
    await expect(page.getByTestId('explorer-inspector')).toContainText(
      'USGS-01646500',
    );
    await page.getByRole('tab', { name: '地图', exact: true }).click();
    await expect(page.getByTestId('explorer-map')).toHaveAttribute(
      'data-ready',
      'true',
    );
    await page.getByText('图层与图例', { exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: '线', exact: true }),
    ).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await revoke(page, [viewId]);
    ids.splice(ids.indexOf(viewId), 1);
    await page.goto(`/zh-CN/data-foundation/explore?saved=${viewId}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('explorer-inspector')).not.toContainText(
      'USGS-01646500',
    );
    expect(errors).toEqual([]);
  } finally {
    await revoke(page, ids);
  }
});
test('saved record pagination survives reopening and exports the same bounded source rows', async ({
  page,
}) => {
  test.setTimeout(90000);
  const ids: string[] = [];
  await login(page);
  try {
    const versionId = '93e7cdb8-2713-56eb-ab18-320a4a61dec3';
    const response = await page.request.post('/api/data-foundation/explore', {
      data: {
        spec: {
          versions: [
            { dataItemId: '1f0e04c9-0d97-4cdb-88c7-074dae13c221', versionId },
          ],
        },
        view: 'resources',
      },
    });
    expect(response.ok()).toBe(true);
    const query = ExplorationResultSchema.parse(await response.json());
    await page.goto(
      `/zh-CN/data-foundation/explore?query=${query.queryId}&view=records`,
    );
    const records = page.getByTestId('explorer-records');
    await expect(records).toBeVisible();
    await records.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(
      records.getByRole('button', { name: '选择记录 26', exact: true }),
    ).toBeVisible();
    await records
      .getByRole('button', { name: '选择记录 26', exact: true })
      .click();
    await save(page, 'CMA second page', ids);
    await page
      .getByRole('link', { name: 'CMA second page', exact: true })
      .click();
    await expect(
      records.getByRole('button', { name: '选择记录 26', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(records).toContainText('记录页 2');
    await page.getByText('保存、分享与导出', { exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '导出当前页（JSON）', exact: true })
      .click();
    const download = await downloaded;
    const file = await download.path();
    expect(file).not.toBeNull();
    const exported = ExportExplorationOutputSchema.parse(
      JSON.parse(await readFile(file, 'utf8')),
    );
    expect(exported.coverage).toMatchObject({
      unit: 'records',
      returnedCount: 25,
      complete: false,
    });
    expect(exported.result.records?.[0]?.index).toBe(26);
    expect(
      exported.result.records?.every(
        (record) => record.versionId === versionId,
      ),
    ).toBe(true);
    await records.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(
      records.getByRole('button', { name: '选择记录 1', exact: true }),
    ).toBeVisible();
  } finally {
    await revoke(page, ids);
  }
});

test('saved source statistics restore the applied measure and exact group result', async ({
  page,
}) => {
  test.setTimeout(60000);
  const ids: string[] = [];
  await login(page);
  try {
    await page
      .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
      .click();
    await page.getByRole('tab', { name: '统计', exact: true }).click();
    const stats = page.getByTestId('explorer-aggregate');
    await expect(stats.getByLabel('来源文件')).toContainText('DS-0558');
    await stats.getByLabel('分组字段').selectOption('c1');
    await stats.getByLabel('统计方式').selectOption('mean');
    await stats
      .getByRole('combobox', { name: '数值字段', exact: true })
      .selectOption('c6');
    await stats.getByRole('button', { name: '计算统计', exact: true }).click();
    await expect(
      stats.getByRole('button', {
        name: '查看分组 USGS-01646500',
        exact: true,
      }),
    ).toBeVisible();
    await save(page, 'NLDI saved mean', ids);
    await page
      .getByRole('link', { name: 'NLDI saved mean', exact: true })
      .click();
    await expect(
      page.getByRole('tab', { name: '统计', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(stats.getByLabel('统计方式')).toHaveValue('mean');
    await expect(
      stats.getByRole('combobox', { name: '数值字段', exact: true }),
    ).toHaveValue('c6');
    await expect(
      stats.getByRole('button', {
        name: '查看分组 USGS-01646500',
        exact: true,
      }),
    ).toBeVisible();
    await expect(stats).toContainText('4512772');
    await expect(page.getByTestId('explorer-aggregate-chart')).toHaveAttribute(
      'data-state',
      'ready',
    );
  } finally {
    await revoke(page, ids);
  }
});
