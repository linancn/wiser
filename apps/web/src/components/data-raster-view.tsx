'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExplorationRecord } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { rasterGrid, rasterPixels } from '@/lib/data-raster';
import { DataContentValue } from './data-content-value';
import styles from './data-resource-content.module.css';

function RasterBand({
  record,
  locale,
}: {
  readonly record: ExplorationRecord;
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation.content.raster;
  const grid = useMemo(() => rasterGrid(record.values), [record.values]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pixel, setPixel] = useState({ row: 0, column: 0 });
  useEffect(() => {
    if (!grid || !canvas.current) return;
    const context = canvas.current.getContext('2d');
    if (!context) return;
    const image = context.createImageData(grid.width, grid.height);
    image.data.set(rasterPixels(grid));
    context.putImageData(image, 0, 0);
  }, [grid]);
  return (
    <article className={styles.raster}>
      <h3>
        {copy.band}{' '}
        <DataContentValue locale={locale} value={record.values['c1']} />
      </h3>
      {grid ? (
        <>
          <p>
            {grid.width.toLocaleString(locale)} ×{' '}
            {grid.height.toLocaleString(locale)} ·{' '}
            {copy.valid.replace('{count}', grid.valid.toLocaleString(locale))}
          </p>
          <canvas
            ref={canvas}
            width={grid.width}
            height={grid.height}
            role="img"
            aria-label={copy.image}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setPixel({
                row: Math.min(
                  grid.height - 1,
                  Math.floor(
                    ((event.clientY - rect.top) / rect.height) * grid.height,
                  ),
                ),
                column: Math.min(
                  grid.width - 1,
                  Math.floor(
                    ((event.clientX - rect.left) / rect.width) * grid.width,
                  ),
                ),
              });
            }}
          />
          <div className={styles.rasterLegend}>
            <span>{grid.min ?? '—'}</span>
            <i aria-hidden="true" />
            <span>
              {grid.max ?? '—'} {grid.unit}
            </span>
          </div>
          <p>{copy.note}</p>
          <div className={styles.rasterSample}>
            <label>
              {copy.row}
              <input
                type="number"
                min={1}
                max={grid.height}
                value={pixel.row + 1}
                onChange={(e) =>
                  setPixel({
                    ...pixel,
                    row: Math.max(
                      0,
                      Math.min(grid.height - 1, Number(e.target.value) - 1),
                    ),
                  })
                }
              />
            </label>
            <label>
              {copy.column}
              <input
                type="number"
                min={1}
                max={grid.width}
                value={pixel.column + 1}
                onChange={(e) =>
                  setPixel({
                    ...pixel,
                    column: Math.max(
                      0,
                      Math.min(grid.width - 1, Number(e.target.value) - 1),
                    ),
                  })
                }
              />
            </label>
            <output aria-live="polite">
              {copy.value}:{' '}
              {grid.values[pixel.row * grid.width + pixel.column] ??
                copy.nodata}{' '}
              {grid.unit}
            </output>
          </div>
        </>
      ) : (
        <p>{copy.unavailable}</p>
      )}
      <DataContentValue locale={locale} value={record.values['c2']} expanded />
      {!grid ? (
        <DataContentValue locale={locale} value={record.values['c3']} />
      ) : null}
    </article>
  );
}

export function DataRasterView({
  records,
  locale,
}: {
  readonly records: readonly ExplorationRecord[];
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation.content;
  return (
    <div className={styles.documents}>
      {records.length ? (
        records.map((record) => (
          <RasterBand key={record.recordId} record={record} locale={locale} />
        ))
      ) : (
        <p>{copy.noRecords}</p>
      )}
    </div>
  );
}
