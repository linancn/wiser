import { expect, test } from '@playwright/test';

test('keeps the live Data Foundation workspace bilingual and fail-closed', async ({
  page,
}, testInfo) => {
  await page.goto('/zh-CN/data-foundation');
  await expect(
    page.getByRole('heading', { name: '数据探索', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '数据基座工作区' }),
  ).toBeVisible();
  await expect(page.getByText('按权限显示')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '暂时无法进入数据基座' }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(
    /HTTP\s*\d{3}|WISER_[A-Z_]+|\/health\/|Capability Registry|DTO|DAL|工作进程/,
  );
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('data-foundation-desktop-light.png'),
  });

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/data-foundation$/);
  await expect(
    page.getByRole('heading', { name: 'Data exploration', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Cannot open Data Foundation right now',
    }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('exposes every Data Foundation workspace route without static data fallback', async ({
  page,
}) => {
  const routes = [
    ['catalog', '数据目录'],
    ['ingestions', '数据接入'],
    ['quality', '质量治理'],
    ['search', '综合检索'],
    ['knowledge', '知识检索'],
    ['graph', '知识图谱'],
    ['geo', '空间查询'],
    ['map', '地图预览'],
    ['capabilities', '智能体接入'],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(`/zh-CN/data-foundation/${route}`);
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('按权限显示')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/fixture|mock/i);
  }
});

test('keeps the Data Foundation control surface usable at 390px', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/zh-CN/data-foundation/map');

  await expect(page.getByRole('heading', { name: '地图预览' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('data-foundation-mobile-dark-map.png'),
  });
});
