import { expect, test, type Page } from '@playwright/test';

import {
  loadLiveCredentials,
  loadLiveDataFixture,
} from './support/live-fixture';

const fixture = loadLiveDataFixture();
const credentials = loadLiveCredentials();
const unsafeNarrative =
  /HTTP\s*\d{3}|WISER_[A-Z_]+|DATA_[A-Z_]+|host\.docker\.internal|api:3001|Bearer\s+[A-Za-z0-9._-]+|sb_[a-z]+_/i;

function detailPath(locale: 'en' | 'zh-CN'): string {
  return `/${locale}/data-foundation/catalog/${fixture.dataItemId}?version=${fixture.versionId}`;
}

async function login(
  page: Page,
  locale: 'en' | 'zh-CN',
  next: string,
): Promise<void> {
  await page.goto(`/${locale}/login?next=${encodeURIComponent(next)}`);
  await page
    .getByLabel(locale === 'zh-CN' ? '邮箱' : 'Email')
    .fill(credentials.email);
  await page
    .getByLabel(locale === 'zh-CN' ? '密码' : 'Password')
    .fill(credentials.password);
  await Promise.all([
    page.waitForURL((url) => `${url.pathname}${url.search}` === next),
    page
      .getByRole('button', { name: locale === 'zh-CN' ? '登录' : 'Sign in' })
      .click(),
  ]);
}

test.describe.serial('real Supabase Auth and Data authority', () => {
  test('preserves the protected destination while switching login locale', async ({
    page,
  }) => {
    const chineseTarget = detailPath('zh-CN');
    await page.goto(chineseTarget);

    let url = new URL(page.url());
    expect(url.pathname).toBe('/zh-CN/login');
    expect(url.searchParams.get('next')).toBe(chineseTarget);
    await expect(
      page.getByRole('heading', { name: '登录 WISER' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'English' }).click();
    const englishTarget = detailPath('en');
    await expect(page).toHaveURL(/\/en\/login\?/);
    url = new URL(page.url());
    expect(url.pathname).toBe('/en/login');
    expect(url.searchParams.get('next')).toBe(englishTarget);
    await expect(page.locator('input[name="next"]')).toHaveValue(englishTarget);

    await page.getByLabel('Email').fill(credentials.email);
    await page.getByLabel('Password').fill(credentials.password);
    const navigation = page.waitForResponse((response) => {
      const responseUrl = new URL(response.url());
      return (
        `${responseUrl.pathname}${responseUrl.search}` === englishTarget &&
        response.request().isNavigationRequest()
      );
    });
    await page.getByRole('button', { name: 'Sign in' }).click();
    const response = await navigation;
    await expect(page).toHaveURL(new RegExp(`${fixture.dataItemId}.*version=`));
    await expect(
      page.getByLabel(`Signed in: ${credentials.email}`),
    ).toBeVisible();
    expect(response.headers()['cache-control']).toMatch(/no-store|no-cache/);
    expect(response.headers()['cache-control']).not.toMatch(
      /public|max-age=[1-9]/,
    );
    await expect(page.locator('main')).toContainText(fixture.dataItemId);
    await expect(page.locator('main')).not.toContainText(unsafeNarrative);
  });

  test('reads the real catalog, ingestion, operation, and governed map chain', async ({
    page,
  }) => {
    const browserOrigins = new Set<string>();
    const rasterRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      browserOrigins.add(url.origin);
      if (url.pathname.includes('/geo/tiles/raster/versions/')) {
        rasterRequests.push(url.pathname);
      }
    });
    await login(page, 'zh-CN', detailPath('zh-CN'));
    await page.getByText('技术详情', { exact: true }).first().click();

    await expect(
      page.getByText(fixture.dataItemId, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /选择版本/ }).filter({ hasText: 'v1' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByText('已发布', { exact: true }).first(),
    ).toBeVisible();

    await page.goto(`/zh-CN/data-foundation/ingestions/${fixture.ingestionId}`);
    await expect(page.getByRole('heading', { name: '接入任务' })).toBeVisible();
    await expect(
      page.getByText(fixture.ingestionId, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('已发布', { exact: true }).first(),
    ).toBeVisible();
    const operation = page.getByRole('link', { name: '查看操作' });
    await expect(operation).toHaveAttribute(
      'href',
      `/zh-CN/data-foundation/operations/${fixture.operationId}`,
    );
    await operation.click();
    await expect(page.getByRole('heading', { name: '任务进度' })).toBeVisible();
    await expect(
      page.getByText(fixture.operationId, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('definition').filter({ hasText: /^100%$/ }),
    ).toBeVisible();
    await expect(
      page.getByText('已成功', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '进度记录' })).toBeVisible();

    await page.getByRole('button', { name: '切换至深色模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wiser-theme')))
      .toBe('dark');
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/en/data-foundation/operations/${fixture.operationId}$`),
    );
    await expect(
      page.getByRole('heading', { name: 'Task progress' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByLabel(`Signed in: ${credentials.email}`),
    ).toBeVisible();

    await page.goto(detailPath('en'));
    const mapLink = page.getByRole('link', {
      name: 'View this version on the map',
    });
    const mapHref = await mapLink.getAttribute('href');
    expect(mapHref).not.toBeNull();
    const mapUrl = new URL(mapHref!, page.url());
    expect(mapUrl.searchParams.get('dataItem')).toBe(fixture.dataItemId);
    expect(mapUrl.searchParams.get('version')).toBe(fixture.versionId);
    expect(mapUrl.searchParams.get('bbox')).toBe(
      '115.6078,39.8496,116.2186,40.2217',
    );
    expect(mapUrl.searchParams.get('crs')).toBe('EPSG:4490');
    await mapLink.click();
    await expect(
      page.getByRole('heading', { name: 'Map preview' }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'Data Foundation spatial data map' }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Vector layer' }),
    ).toBeEnabled();
    await expect(
      page.getByRole('checkbox', { name: 'Raster layer' }),
    ).toBeDisabled();
    const currentMapUrl = new URL(page.url());
    expect(currentMapUrl.searchParams.get('dataItem')).toBe(fixture.dataItemId);
    expect(currentMapUrl.searchParams.get('version')).toBe(fixture.versionId);

    const vector = await page.request.get(
      `/api/data-foundation/geo/tiles/vector/versions/${fixture.versionId}/0/0/0.pbf`,
      { maxRedirects: 0 },
    );
    expect(vector.status()).toBe(200);
    expect(vector.headers()['content-type']).toMatch(
      /application\/(?:vnd\.mapbox-vector-tile|x-protobuf|octet-stream)/,
    );
    expect([...browserOrigins]).not.toEqual(
      expect.arrayContaining([
        'http://api:3001',
        'http://host.docker.internal:56321',
      ]),
    );
    expect(rasterRequests).toEqual([]);
    await expect(page.locator('main')).not.toContainText(unsafeNarrative);
  });

  test('fails closed for a corrupted session and signs out through the real route', async ({
    context,
    page,
  }) => {
    await login(page, 'zh-CN', '/zh-CN/data-foundation');
    const cookies = await context.cookies();
    const authCookies = cookies.filter(({ name }) => name.startsWith('sb-'));
    expect(authCookies.length).toBeGreaterThan(0);
    await context.addCookies(
      authCookies.map((cookie) => ({ ...cookie, value: 'corrupt-session' })),
    );

    await page.goto(detailPath('zh-CN'));
    let url = new URL(page.url());
    expect(url.pathname).toBe('/zh-CN/login');
    expect(url.searchParams.get('next')).toBe(detailPath('zh-CN'));

    await login(page, 'zh-CN', '/zh-CN/data-foundation/map?bbox=invalid');
    await expect(
      page.getByRole('heading', { name: '请检查查询条件' }),
    ).toBeVisible();
    await expect(page.locator('main')).not.toContainText(unsafeNarrative);

    await page.getByRole('button', { name: '退出' }).click();
    await expect(page).toHaveURL(/\/zh-CN\/login\?signedOut=1$/);
    await expect(page.getByRole('status')).toContainText('已安全退出');
    await page.goto(`/zh-CN/data-foundation/operations/${fixture.operationId}`);
    url = new URL(page.url());
    expect(url.pathname).toBe('/zh-CN/login');
    expect(url.searchParams.get('next')).toBe(
      `/zh-CN/data-foundation/operations/${fixture.operationId}`,
    );
  });
});
