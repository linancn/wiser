import { expect, test, type Page } from '@playwright/test';
import { loadLiveCredentials } from './support/live-fixture';

const credentials = loadLiveCredentials();
test.skip(
  process.env['WISER_DATA_REAL_CASE'] !== '1',
  'Requires the admitted water research case.',
);
const resource = '0aaa32a4-6d76-479b-a33a-91775d426d50';
const version = '3c9220e3-a5dc-5254-b134-4cc0f6944108';
async function login(page: Page, next: string) {
  const english = next.startsWith('/en/');
  await page.goto(
    `/${english ? 'en' : 'zh-CN'}/login?next=${encodeURIComponent(next)}`,
  );
  await page.getByLabel(english ? 'Email' : '邮箱').fill(credentials.email);
  await page
    .getByLabel(english ? 'Password' : '密码')
    .fill(credentials.password);
  await page
    .getByRole('button', { name: english ? 'Sign in' : '登录', exact: true })
    .click();
  await expect(page).toHaveURL((url) => url.pathname + url.search === next);
}

test('quality review stays compact and continues the same named search', async ({
  page,
}) => {
  await login(page, '/zh-CN/data-foundation/quality?q=water');
  const table = page.getByRole('table');
  await expect(table.getByTestId('data-item-row')).toHaveCount(25);
  await expect(
    table.getByRole('columnheader', { name: '验收状态' }),
  ).toBeVisible();
  const first = await table.getByRole('link').first().getAttribute('href');
  expect(
    await page
      .locator('main')
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(1600);
  await page.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(page).toHaveURL(/q=water&after=/);
  await expect(table.getByRole('link').first()).not.toHaveAttribute(
    'href',
    first!,
  );
  await page.getByRole('link', { name: '返回第一页', exact: true }).click();
  await expect(table.getByRole('link').first()).toHaveAttribute('href', first!);
});

for (const route of ['search', 'knowledge']) {
  test(`${route} has bounded cursor pages and traceable named results`, async ({
    page,
  }) => {
    await login(page, `/zh-CN/data-foundation/${route}?q=HydroATLAS`);
    const results = page.getByRole('region', {
      name: route === 'search' ? '检索结果' : '知识证据',
    });
    await expect(results.getByRole('article')).toHaveCount(10);
    const link = results
      .getByRole('article')
      .first()
      .getByRole('heading')
      .getByRole('link');
    await expect(link).toHaveAttribute(
      'href',
      /\/catalog\/[a-f0-9-]+\?version=[a-f0-9-]+$/,
    );
    expect((await link.innerText()).length).toBeGreaterThan(5);
    const visible = await results.innerText();
    expect(visible).not.toMatch(
      /credential_ref|neo4j|weaviate|page_or_entry_snapshot|sha256:/,
    );
    await page.getByRole('link', { name: '下一页', exact: true }).click();
    await expect(page).toHaveURL(/q=HydroATLAS&after=/);
    await expect(results.getByRole('article')).toHaveCount(10);
    await page.getByRole('link', { name: '返回第一页', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}\\?q=HydroATLAS$`));
  });
}

test('a resource enters linked views with its exact version and real map record', async ({
  page,
}) => {
  await login(
    page,
    `/zh-CN/data-foundation/catalog/${resource}?version=${version}`,
  );
  await page
    .getByRole('link', { name: '查看记录、地图与分析', exact: true })
    .click();
  await expect(page).toHaveURL(/\/data-foundation\/explore\?/);
  await expect(page.getByTestId('explorer-total')).toContainText('1');
  await page
    .getByRole('button', { name: 'DS-0558 · NLDI API', exact: true })
    .click();
  await expect(
    page
      .getByTestId('explorer-inspector')
      .getByRole('link', { name: '查看数据详情', exact: true }),
  ).toHaveAttribute(
    'href',
    `/zh-CN/data-foundation/catalog/${resource}?version=${version}`,
  );
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.getByTestId('explorer-map')).toHaveAttribute(
    'data-rendered-feature-count',
    '1',
  );
  await page.getByRole('tab', { name: '知识图谱', exact: true }).click();
  await expect(
    page.getByTestId('explorer-graph').getByTestId('knowledge-graph'),
  ).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('explorer-graph')).toContainText('DS-0558');
});

for (const locale of ['zh-CN', 'en'])
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark'] as const) {
      test(`all data surfaces remain readable in ${locale}, ${theme}, ${width}px`, async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await login(page, `/${locale}/data-foundation`);
        await page.evaluate((theme) => {
          localStorage.setItem('wiser-theme', theme);
          document.documentElement.dataset.theme = theme;
        }, theme);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        for (const route of [
          '',
          '/catalog',
          '/quality',
          '/ingestions',
          '/search',
          '/knowledge',
          '/map',
          '/graph',
          '/geo',
          '/capabilities',
          `/catalog/${resource}`,
          `/lineage/${resource}`,
          '/ingestions/e259b2bc-f993-47e5-bb5d-9535285bf786',
          '/operations/df6855a9-3cd5-4bd7-ab0e-e02d0da2de84',
          '/map?bbox=invalid',
        ]) {
          await page.goto(`/${locale}/data-foundation${route}`);
          await expect(page.locator('main h1')).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          expect(await page.locator('main').innerText()).not.toMatch(
            /data\.catalog\.read|data\.ingestion\.create|SCHEMA_SEMANTIC_MAPPING|WISER_[A-Z_]+|HTTP\s*\d{3}|DTO|DAL|Outbox/,
          );
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            theme,
          );
        }
        expect(errors).toEqual([]);
      });
    }
