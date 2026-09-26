import { expect, test } from '@playwright/test';

for (const locale of ['zh-CN', 'en'])
  for (const decision of ['approve', 'deny'])
    test(`consent form retains a verifiable origin ${locale}/${decision}`, async ({
      page,
    }) => {
      // Reference mode has no Auth session. Exercise the real page's referrer
      // policy and native form transport before the handler rejects that session.
      await page.goto(`/${locale}/oauth/consent?authorization_id=fixture`);
      const expectedOrigin = new URL(page.url()).origin;
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/${locale}/oauth/consent/decision` &&
          r.request().method() === 'POST',
      );
      await page.evaluate(
        ({ locale, decision }) => {
          const form = document.createElement('form');
          form.method = 'post';
          form.action = `/${locale}/oauth/consent/decision`;
          for (const [name, value] of Object.entries({
            authorization_id: 'fixture',
            decision,
          })) {
            const field = document.createElement('input');
            field.name = name;
            field.value = value;
            form.append(field);
          }
          document.body.append(form);
          form.submit();
        },
        { locale, decision },
      );
      const result = await response;
      expect(result.request().headers().origin).toBe(expectedOrigin);
      expect(result.status()).toBe(303);
      expect(result.headers().location).toContain('error=unavailable');
    });

test('consent requests keep external referrers private and reject untrusted origins', async ({
  page,
  request,
}) => {
  await page.goto('/zh-CN/oauth/consent?authorization_id=fixture');
  const destination = 'https://oauth-client.invalid/callback';
  await page.route(destination, (route) => route.fulfill({ body: 'fixture' }));
  const navigation = page.waitForRequest(destination);
  await page.evaluate((target) => {
    const link = document.createElement('a');
    link.href = target;
    document.body.append(link);
    link.click();
  }, destination);
  expect((await navigation).headers().referer).toBeUndefined();
  for (const origin of ['null', 'https://oauth-client.invalid']) {
    const rejected = await request.post('/zh-CN/oauth/consent/decision', {
      headers: { origin },
      form: { authorization_id: 'fixture', decision: 'deny' },
      maxRedirects: 0,
    });
    expect(rejected.status()).toBe(403);
  }
});
