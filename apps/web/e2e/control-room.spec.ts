import { expect, test } from '@playwright/test';

test('redirects to the Chinese control room and switches language', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/zh-CN$/);
  await expect(
    page.getByRole('heading', {
      name: '2023 永定河春季生态补水——京津冀多水源联合调度（事实锚定合成版）',
    }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('heading', { name: /Yongding River/i }),
  ).toBeVisible();
});

test('exposes all three operator experiences', async ({ page }) => {
  await page.goto('/zh-CN');

  await expect(page.getByRole('heading', { name: '场景说明' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '导调控制台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '事件回放' })).toBeVisible();
  await page.getByRole('button', { name: '反馈返回', exact: true }).click();
  const trace = page.getByRole('list', { name: '智能体运行链路' });
  await expect(trace.getByText('L2 反馈返回')).toBeVisible();
  await expect(trace.getByText('首轮方案提交')).toBeHidden();
});
