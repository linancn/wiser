import { expect, test } from '@playwright/test';

test('serves Chinese by default and preserves the English corpus', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(
    page.getByRole('heading', { name: 'wiser water, better future' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'WISER WISER Platform' }),
  ).toBeVisible();
  await expect(page.locator('main')).toContainText('数据基座');
  await expect(page.getByRole('heading', { name: '系统地图' })).toBeVisible();

  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('link', { name: 'WISER WISER Platform' }),
  ).toBeVisible();
  await expect(page.locator('main')).toContainText('Data Foundation');
  await expect(page.getByRole('heading', { name: 'System map' })).toBeVisible();

  await page.goto('/quick-start/');
  await expect(page.getByRole('heading', { name: '快速开始' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '0. 前置条件' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '选择文档语言' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/quick-start\/$/);

  await expect(
    page.getByRole('heading', { name: 'Quick start' }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/[\u3400-\u9fff]/);

  await page.goto('/development/');
  await expect(page.getByRole('heading', { name: '开发手册' })).toBeVisible();
  await page.getByRole('button', { name: '选择文档语言' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/development\/$/);
  await expect(
    page.getByRole('heading', { name: 'Development guide' }),
  ).toBeVisible();

  await page.goto('/development/product-experience/');
  await expect(
    page.getByRole('heading', { name: '产品界面与内容设计' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '选择文档语言' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/development\/product-experience\/$/);
  await expect(
    page.getByRole('heading', {
      name: 'Product interface and content design',
    }),
  ).toBeVisible();
});

test('keeps the migrated document routes and built-in search available', async ({
  page,
}) => {
  await page.goto('/architecture/multi-agent-observability/');
  await expect(
    page.getByRole('heading', { name: '多智能体导调与可观测性' }),
  ).toBeVisible();
  const searchButton = page.locator('button[data-search-full]');
  await expect(searchButton).toBeVisible();
  await searchButton.click();
  const searchDialog = page.getByRole('dialog', { name: '搜索文档' });
  await searchDialog.getByRole('textbox').fill('OpenTelemetry');
  await expect(searchDialog).toContainText(
    /Agent EXCON 架构|多智能体导调与可观测性/,
  );
  await page.keyboard.press('Escape');
  await expect(searchDialog).toBeHidden();
  await expect(
    page.getByRole('link', { name: '在 GitHub 编辑' }),
  ).toHaveAttribute('href', /github\.com\/linancn\/wiser/);

  await page.goto('/protocols/mcp/');
  await expect(
    page.getByRole('heading', { name: 'Agent EXCON MCP 接入' }),
  ).toBeVisible();
});

test('renders the documentation without overflow or browser errors', async ({
  browser,
}, testInfo) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 1000 },
      { name: 'mobile-390', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        colorScheme,
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));

      for (const route of [
        { name: 'home', path: '/' },
        { name: 'quick-start', path: '/quick-start/' },
        { name: 'development', path: '/development/' },
      ]) {
        await page.goto(route.path);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(
            `${viewport.name}-${colorScheme}-fumadocs-${route.name}.png`,
          ),
        });
      }
      await context.close();
    }
  }
});
