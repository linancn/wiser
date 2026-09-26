import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { getDictionary } from '../src/lib/i18n';
const css = readFileSync(
  new URL('../src/components/data-explorer.module.css', import.meta.url),
  'utf8',
).replace(/:global\(([^)]+)\)/g, '$1');
const basemapCss = readFileSync(
  new URL('../src/components/amap-basemap.module.css', import.meta.url),
  'utf8',
).replace(/:global\(([^)]+)\)/g, '$1');

for (const locale of ['zh-CN', 'en'] as const)
  for (const width of [390, 1440])
    for (const failed of [false, true])
      test(`basemap notice preserves map actions ${locale}/${width}/${failed}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const copy = getDictionary(locale).dataFoundation;
        await page.setContent(
          `<style>${css}${basemapCss}</style><section style="position:relative"><div class="mapSummary"><button>${copy.explorer.fitMap}</button><button>${copy.explorer.mapLayers.filter}</button><span>${copy.explorer.shownFeatures} 1</span></div><div class="mapCanvas"><div class="status" role="status"><span>${failed ? copy.amap.failed : copy.amap.loading}</span>${failed ? `<button>${copy.amap.retry}</button>` : ''}</div></div></section>`,
        );
        const status = await page.getByRole('status').boundingBox();
        expect(status).not.toBeNull();
        for (const name of [
          copy.explorer.fitMap,
          copy.explorer.mapLayers.filter,
        ]) {
          const button = page.getByRole('button', { name, exact: true });
          const bounds = await button.boundingBox();
          expect(bounds).not.toBeNull();
          expect(
            Math.min(bounds!.y + bounds!.height, status!.y + status!.height) -
              Math.max(bounds!.y, status!.y),
          ).toBeLessThanOrEqual(0);
          await button.click();
          await expect(button).toBeFocused();
        }
        if (failed)
          await page
            .getByRole('button', { name: copy.amap.retry, exact: true })
            .click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });

for (const locale of ['zh-CN', 'en'] as const)
  for (const width of [390, 1440])
    for (const failed of [false, true])
      test(`map note leaves controls visible ${locale}/${width}/${failed}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const note = getDictionary(locale).dataFoundation.amap.positionLimit;
        await page.setContent(
          `<style>${css}</style><section style="position:relative"><div class="mapCanvas">${failed ? `<div class="mapNotice" role="status"><button>Retry</button></div>` : '<details class="mapLegend" open><summary>Layers</summary><fieldset><label><input type="checkbox">Vector features</label><label><input type="checkbox">Raster</label></fieldset></details>'}</div><p class="mapPositionNote" role="note">${note}</p></section>`,
        );
        const control = page.locator(failed ? '.mapNotice' : '.mapLegend');
        const a = await control.boundingBox(),
          b = await page.getByRole('note').boundingBox();
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(
          Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y),
        ).toBeLessThanOrEqual(0);
        await expect(
          control.locator(failed ? 'button' : 'summary'),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
