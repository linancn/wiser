import { expect, it } from 'vitest';
import { rasterDisplay, rasterDisplayUrl } from './raster-display';
it('keeps missing values separate from zero and carries only display options to governed tiles', () => {
  const d = rasterDisplay({
    band: '1',
    min: '0',
    max: '50',
    nodata: '-9999',
    unit: 'mm for this day',
  });
  expect(d).toMatchObject({
    min: 0,
    max: 50,
    nodata: -9999,
    unit: 'mm for this day',
  });
  const url = rasterDisplayUrl('/tile.png?existing=value', d);
  expect(url).toContain('nodata=-9999');
  expect(url).toContain('rescale=0%2C50');
  expect(url).toContain('return_mask=true');
  expect(url).not.toContain('mm');
  expect(rasterDisplayUrl('/tile.png', null)).toBe('/tile.png');
  expect(
    rasterDisplayUrl(
      '/tile.png?nodata=0',
      rasterDisplay({ band: '1', min: '-2', max: '2', nodata: '', unit: '' }),
    ),
  ).not.toContain('nodata');
});
it.each([
  { min: '' },
  { max: '0' },
  { min: 'Infinity' },
  { band: '1.5' },
  { band: '257' },
  { nodata: 'NaN' },
  { min: '-1e3' },
  { max: '1000000000000000000000' },
  { max: '0.00000001' },
])('rejects an invalid display without inventing a range: %j', (change) => {
  expect(
    rasterDisplay({
      band: '1',
      min: '0',
      max: '50',
      nodata: '',
      unit: '',
      ...change,
    }),
  ).toBeNull();
});
