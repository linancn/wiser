import { expect, test, type Page } from '@playwright/test';
import { loadLiveCredentials } from './support/live-fixture';

const credentials = loadLiveCredentials();
const hydroAtlasId = 'e90d54eb-4740-4f21-a85e-1d497cc2cc57';

test('real NLDI records select the same station on the exploration map', async ({
  page,
}) => {
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
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-selected-record',
    /^[0-9a-f-]{36}$/,
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
  await expect(page.getByTestId('explorer-inspector')).toContainText('待解析');
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
