import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const mixedChineseProductTerms =
  /\b(?:Operator|Agent Session|Agent|Run|Trace|Barrier|ArtifactVersion|Receipt|Event|Telemetry|Best-effort|Thread|Operation|Exporter|Revision|Verdict|Evidence|Inject|Feedback|Prompt|Tool|payload|cursor|signal|live|Web|Log|Logs|Metric|Links?|ROLE|BARRIER|VERDICT|AUTHORITY|TELEMETRY|TRIAGE|MESSAGE|ARTIFACTVERSION|FLOW)\b/;

async function visibleNarrativeText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          element.tagName !== 'CODE' &&
          element.closest('code') === null &&
          element.children.length === 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0 &&
          (element.textContent ?? '').trim().length > 0
        );
      })
      .map((element) => (element.textContent ?? '').trim())
      .join('\n'),
  );
}

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

  for (const route of [
    'scenarios',
    'runs/run-yongding-spring-042',
    'runs/run-yongding-spring-042/collaboration',
    'runs/run-yongding-spring-042/diagnostics',
    'runs/run-yongding-spring-042/trace',
    'runs/run-yongding-spring-042/replay',
  ]) {
    await page.goto(`/en/${route}`);
    await expect(page.locator('main'), route).not.toContainText(
      /[\u3400-\u9fff]/,
    );
  }
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

test('uses consistent professional Chinese while preserving protocol terms', async ({
  page,
}) => {
  for (const route of [
    'scenarios',
    'scenarios/yongding-2023-ecological-replenishment',
    'runs',
    'runs/run-yongding-spring-042',
    'runs/run-yongding-spring-042/collaboration',
    'runs/run-yongding-spring-042/diagnostics',
    'runs/run-yongding-spring-042/trace',
    'runs/run-yongding-spring-042/replay',
  ]) {
    await page.goto(`/zh-CN/${route}`);
    const text = (await visibleNarrativeText(page)).replaceAll(
      'Agent EXCON',
      '',
    );
    expect(text, route).not.toMatch(mixedChineseProductTerms);
  }

  await page.goto('/zh-CN/scenarios');
  await expect(
    page.getByText(
      '当前展示导调员使用的管理视图预览。每个场景独立版本化，并明确多智能体角色、阶段契约和评价边界；参训智能体仍通过 Skill、HTTP 或 MCP 与平台交互。',
      { exact: true },
    ),
  ).toBeVisible();
});

test('separates scenario management from active multi-agent runs', async ({
  page,
}) => {
  await page.goto('/zh-CN/scenarios');
  await page
    .getByTestId('scenario-card')
    .filter({ hasText: '永定河联合调度' })
    .getByRole('link', { name: '查看场景' })
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
  await expect(page.getByText('裁决通过', { exact: true })).toBeVisible();
  await expect(page.getByText('遥测有缺口', { exact: true })).toBeVisible();
  await expect(page.getByText('待办与风险', { exact: true })).toBeVisible();
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

  await page.getByRole('link', { name: '追踪' }).click();
  await expect(page).toHaveURL(/\/trace$/);

  await expect(page.getByRole('heading', { name: '追踪分析' })).toBeVisible();
  await expect(page.getByTestId('agent-lane')).toHaveCount(5);
  await expect(
    page.getByRole('heading', { name: '诊断与确定性评测' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /调度协调/ }).click();
  await expect(page.getByTestId('span-inspector')).toContainText('智能体');

  await page.getByRole('link', { name: '回放' }).click();
  await expect(page).toHaveURL(/\/replay$/);
  await page.getByLabel('回放视角').selectOption('agent-ecology');
  await expect(page.getByText('生态目标智能体当时可见')).toBeVisible();
  await expect(page.getByTestId('replay-event')).toHaveCount(5);
});

test('shows causal agent exchanges and per-recipient delivery without claiming they were read', async ({
  page,
}, testInfo) => {
  await page.goto('/zh-CN/runs/run-yongding-spring-042/collaboration');

  await expect(
    page.getByRole('heading', { name: '协作汇流', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '协作' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const refreshButton = page.getByRole('button', { name: '刷新协作状态' });
  await expect(refreshButton).toBeVisible();
  await expect(page.getByTestId('collaboration-refresh-status')).toContainText(
    '参考投影',
  );
  await refreshButton.click();
  await expect(refreshButton).toBeEnabled();
  await expect(page.getByTestId('collaboration-refresh-status')).toContainText(
    '最后更新',
  );
  await expect(page.getByTestId('collaboration-exchange')).toHaveCount(7);
  await expect(page.getByTestId('collaboration-handoff')).toHaveCount(3);
  await expect(page.getByTestId('collaboration-request')).toHaveCount(1);
  await expect(page.getByText('3 个专业工件已交接')).toBeVisible();

  const request = page.getByTestId('collaboration-request');
  const requestButton = request.getByRole('button').first();
  await expect(requestButton).toHaveAttribute('aria-expanded', 'false');
  const mobileRegionId = await requestButton.getAttribute('aria-controls');
  expect(mobileRegionId).toMatch(/^mobile-exchange-detail-/);
  await requestButton.click();
  await expect(requestButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('collaboration-inspector')).toContainText(
    '来水研判智能体',
  );
  await expect(page.getByTestId('collaboration-inspector')).toContainText(
    '接收批次已确认',
  );
  await expect(page.getByText('已读', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('desktop-collaboration-expanded.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('collaboration-exchange')).toHaveCount(7);
  const mobileRequest = page.getByTestId('collaboration-request');
  const mobileRequestButton = mobileRequest.getByRole('button').first();
  await mobileRequestButton.click();
  const mobileDetail = mobileRequest.getByTestId('mobile-exchange-detail');
  await expect(mobileDetail).toBeVisible();
  await expect(mobileDetail).toHaveAttribute('role', 'region');
  const smallestExpanded = await mobileDetail.evaluate((root) =>
    [...root.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0 &&
          element.children.length === 0 &&
          (element.textContent ?? '').trim().length > 0
        );
      })
      .reduce(
        (minimum, element) =>
          Math.min(
            minimum,
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
        Number.POSITIVE_INFINITY,
      ),
  );
  expect(smallestExpanded).toBeGreaterThanOrEqual(11.5);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('mobile-collaboration-expanded.png'),
  });

  await mobileRequestButton.click();
  await expect(mobileRequestButton).toHaveAttribute('aria-expanded', 'false');
  await expect(mobileDetail).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/en/runs/run-yongding-spring-042/collaboration');
  await expect(
    page.getByRole('heading', {
      name: 'Collaboration confluence',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId('collaboration-agent-node')).toHaveCount(4);
  const firstNode = await page
    .getByTestId('collaboration-agent-node')
    .nth(0)
    .boundingBox();
  const secondNode = await page
    .getByTestId('collaboration-agent-node')
    .nth(1)
    .boundingBox();
  expect(secondNode?.y).toBeGreaterThan(firstNode?.y ?? 0);
  const englishOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(englishOverflow).toBeLessThanOrEqual(1);
  const replayTab = await page
    .getByRole('link', { name: 'Replay', exact: true })
    .boundingBox();
  expect((replayTab?.x ?? 321) + (replayTab?.width ?? 0)).toBeLessThanOrEqual(
    320,
  );
});

test('keeps the operator workspace usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-CN/runs/run-yongding-spring-042/trace');

  await expect(page.getByRole('heading', { name: '追踪分析' })).toBeVisible();
  await expect(page.getByTestId('mobile-trace-event')).toHaveCount(10);
  await expect(page.getByTestId('mobile-trace-event').first()).toBeVisible();
  await expect(page.locator('.waterfall-panel')).toBeHidden();
  await page.getByTestId('mobile-trace-event').nth(3).click();
  await expect(page.getByTestId('span-inspector')).toContainText('智能体');
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('keeps visible Run workspace text at a human-readable size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['collaboration', 'diagnostics', 'trace', 'replay']) {
    await page.goto(`/zh-CN/runs/run-yongding-spring-042/${route}`);
    const smallest = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0 &&
            element.children.length === 0 &&
            (element.textContent ?? '').trim().length > 0
          );
        })
        .reduce(
          (minimum, element) =>
            Math.min(
              minimum,
              Number.parseFloat(getComputedStyle(element).fontSize),
            ),
          Number.POSITIVE_INFINITY,
        ),
    );
    expect(smallest).toBeGreaterThanOrEqual(11.5);
  }
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
    await expect(page.getByRole('heading', { name: '追踪分析' })).toBeVisible();
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
