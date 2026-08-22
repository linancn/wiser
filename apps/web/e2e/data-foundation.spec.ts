import { expect, test } from '@playwright/test';

test('keeps the live Data Foundation workspace bilingual and fail-closed', async ({
  page,
}, testInfo) => {
  await page.goto('/zh-CN/data-foundation');
  await expect(
    page.getByRole('heading', { name: '数据基座运行面' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '数据基座工作区' }),
  ).toBeVisible();
  await expect(page.getByText('不使用参考样例')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '数据工作区尚未配置' }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('data-foundation-desktop-light.png'),
  });

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/data-foundation$/);
  await expect(
    page.getByRole('heading', { name: 'Data Foundation operations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'The data workspace is not configured' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('exposes every Data Foundation workspace route without static data fallback', async ({
  page,
}) => {
  const routes = [
    ['catalog', '数据目录'],
    ['ingestions', '入库会话'],
    ['quality', '质量治理'],
    ['search', '综合检索'],
    ['knowledge', '知识检索'],
    ['graph', '知识图谱'],
    ['geo', '空间查询'],
    ['map', '地图预览'],
    ['capabilities', '能力注册表'],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(`/zh-CN/data-foundation/${route}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByText('不使用参考样例')).toBeVisible();
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
