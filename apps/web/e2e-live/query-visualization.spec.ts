import { expect, test, type Page } from '@playwright/test';
import { loadLiveCredentials } from './support/live-fixture';

const credentials = loadLiveCredentials();
const hydroAtlasId = 'e90d54eb-4740-4f21-a85e-1d497cc2cc57';

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
