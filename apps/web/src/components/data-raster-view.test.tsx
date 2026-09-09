// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataRasterView } from './data-raster-view';
import type { ExplorationRecord } from '@wiser/data-contracts';
const id = '10000000-0000-4000-8000-000000000001';
function record(values: ExplorationRecord['values']): ExplorationRecord {
  return {
    recordId: id,
    featureId: null,
    sourceId: null,
    analysisId: id,
    dataItemId: id,
    versionId: id,
    assetId: id,
    index: 1,
    values,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('lets keyboard and pointer users inspect exact zero, negative, missing and bounded pixels', () => {
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(16) }),
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  render(
    <DataRasterView
      locale="zh-CN"
      records={[
        record({
          __kind: 'RASTER_BAND',
          c1: 'Rain',
          c2: { unit: 'mm' },
          c3: [
            [null, -2],
            [0, 6],
          ],
        }),
      ]}
    />,
  );
  expect(putImageData).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('无有效值');
  fireEvent.change(screen.getByLabelText('行'), { target: { value: '2' } });
  expect(screen.getByRole('status').textContent).toContain('0 mm');
  fireEvent.change(screen.getByLabelText('列'), { target: { value: '99' } });
  expect(screen.getByRole('status').textContent).toContain('6 mm');
  const canvas = screen.getByRole('img');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  } as DOMRect);
  fireEvent.click(canvas, { clientX: 150, clientY: 50 });
  expect(screen.getByRole('status').textContent).toContain('-2 mm');
});
it('shows metadata without inventing an image for unavailable and all-masked bands', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const view = render(
    <DataRasterView
      locale="en"
      records={[
        record({
          __kind: 'NETCDF_VARIABLE',
          c1: 'Missing',
          c2: { unit: 'm' },
          c3: null,
        }),
      ]}
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
  view.rerender(
    <DataRasterView
      locale="en"
      records={[record({ __kind: 'RASTER_BAND', c1: 'Masked', c3: [[null]] })]}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('No valid value');
  view.rerender(<DataRasterView locale="en" records={[]} />);
  expect(screen.queryByRole('img')).toBeNull();
});
