import { expect, test } from '@playwright/test';

test('Portal copies an actionable setup prompt in both locales and provides a manual fallback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const [locale, name] of [
    ['zh-CN', '让智能体接入 WISER'],
    ['en', 'Connect your agent to WISER'],
  ]) {
    await page.goto(`/${locale}`);
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        'Fetch and execute the appropriate instructions to set me up for WISER from http://127.0.0.1:3101/agent-setup/prompt.md',
      );
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-CN');
  await page
    .getByRole('button', { name: '让智能体接入 WISER', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: '接入指令' })).toHaveValue(
    /\/agent-setup\/prompt\.md$/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
