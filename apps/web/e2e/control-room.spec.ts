import { expect, test } from '@playwright/test';

test('opens the Chinese scenario center and preserves the route in English', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/zh-CN\/scenarios$/);
  await expect(page.getByRole('heading', { name: '场景中心' })).toBeVisible();
  await expect(page.getByTestId('scenario-card')).toHaveCount(3);

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/scenarios$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('heading', { name: 'Scenario center' }),
  ).toBeVisible();
});

test('uses a two-level global navigation and enters Runs through overview', async ({
  page,
}) => {
  await page.goto('/zh-CN/runs');

  const globalNav = page.getByRole('navigation', { name: '主导航' });
  await expect(globalNav.getByRole('link')).toHaveCount(2);
  await expect(globalNav.getByRole('link', { name: '场景库' })).toBeVisible();
  await expect(
    globalNav.getByRole('link', { name: '运行指挥' }),
  ).toHaveAttribute('aria-current', 'page');
  const runLink = page
    .getByTestId('run-row')
    .filter({ hasText: '永定河春季协同演练 #042' })
    .getByRole('link', { name: '打开运行' });
  await expect(runLink).toHaveAttribute(
    'href',
    '/zh-CN/runs/run-yongding-spring-042',
  );

  await page.goto('/zh-CN/scenarios');
  const scenarioRunLink = page
    .getByTestId('scenario-card')
    .filter({ hasText: '永定河联合调度' })
    .getByRole('link', { name: '打开运行' });
  await expect(scenarioRunLink).toHaveAttribute(
    'href',
    '/zh-CN/runs/run-yongding-spring-042',
  );
});

test('declares the route locale in server-rendered HTML without JavaScript', async ({
  request,
}) => {
  for (const locale of ['zh-CN', 'en'] as const) {
    const response = await request.get(`/${locale}/scenarios`);
    expect(response.ok()).toBe(true);
    await expect(response.text()).resolves.toContain(`<html lang="${locale}"`);
  }
});

test('separates scenario management from active multi-agent runs', async ({
  page,
}) => {
  await page.goto('/zh-CN/scenarios');
  await page
    .getByTestId('scenario-card')
    .filter({ hasText: '永定河联合调度' })
    .getByRole('link', { name: '管理场景' })
    .click();

  await expect(page.getByRole('heading', { name: '场景编排' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '角色与协作契约' }),
  ).toBeVisible();
  await expect(page.getByTestId('scenario-contract-summary')).toContainText(
    '4 个必需角色',
  );
  await expect(page.getByTestId('role-slot')).toHaveCount(4);
  await expect(page.getByTestId('associated-run')).toHaveCount(1);
  await expect(
    page.getByTestId('associated-run').getByRole('link', { name: '打开运行' }),
  ).toHaveAttribute('href', '/zh-CN/runs/run-yongding-spring-042');
});

test('opens a human-first Run overview before technical drill-down', async ({
  page,
}) => {
  await page.goto('/zh-CN/runs/run-yongding-spring-042');

  await expect(page.getByRole('heading', { name: '导调总览' })).toBeVisible();
  await expect(page.getByText('权威通过', { exact: true })).toBeVisible();
  await expect(page.getByText('遥测有缺口', { exact: true })).toBeVisible();
  await expect(page.getByText('下一步关注', { exact: true })).toBeVisible();
  await expect(page.getByTestId('run-decision-spine')).toBeVisible();
  await expect(page.getByRole('link', { name: '总览' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const attention = await page
    .getByTestId('attention-item')
    .first()
    .boundingBox();
  expect(attention?.y).toBeLessThan(1000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileAttention = await page
    .getByTestId('attention-item')
    .first()
    .boundingBox();
  expect(mobileAttention?.y).toBeLessThan(844);
});

test('observes parallel agents, cross-agent links, and perspective replay', async ({
  page,
}) => {
  await page.goto('/zh-CN/runs/run-yongding-spring-042/diagnostics');

  await expect(
    page.getByRole('heading', { name: '诊断与确定性评测' }),
  ).toBeVisible();
  await expect(page.getByTestId('diagnostic-summary')).toContainText('4 / 4');
  await expect(page.getByTestId('evaluation-row')).toHaveCount(6);
  await expect(page.getByRole('link', { name: '评测' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('link', { name: 'Trace' }).click();
  await expect(page).toHaveURL(/\/trace$/);

  await expect(page.getByRole('heading', { name: 'Trace 探索' })).toBeVisible();
  await expect(page.getByTestId('agent-lane')).toHaveCount(5);
  await expect(
    page.getByRole('heading', { name: '诊断与确定性评测' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /调度协调/ }).click();
  await expect(page.getByTestId('span-inspector')).toContainText('Agent');

  await page.getByRole('link', { name: '回放' }).click();
  await expect(page).toHaveURL(/\/replay$/);
  await page.getByLabel('回放视角').selectOption('agent-ecology');
  await expect(page.getByText('生态目标智能体当时可见')).toBeVisible();
  await expect(page.getByTestId('replay-event')).toHaveCount(5);
});

test('keeps the operator workspace usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-CN/runs/run-yongding-spring-042/trace');

  await expect(page.getByRole('heading', { name: 'Trace 探索' })).toBeVisible();
  await expect(page.getByTestId('mobile-trace-event')).toHaveCount(10);
  await expect(page.getByTestId('mobile-trace-event').first()).toBeVisible();
  await expect(page.locator('.waterfall-panel')).toBeHidden();
  await page.getByTestId('mobile-trace-event').nth(3).click();
  await expect(page.getByTestId('span-inspector')).toContainText('Agent');
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('visually checks the read-only preview at desktop and 390px without browser errors', async ({
  browser,
}, testInfo) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    await page.goto('/zh-CN/runs/run-yongding-spring-042/trace');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('设计预览')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '多智能体协作 Trace' }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(browserErrors).toEqual([]);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`${viewport.name}-trace.png`),
    });
    await context.close();
  }
});
