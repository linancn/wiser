'use client';
import { useState } from 'react';
import { rasterDisplay, type RasterDisplay } from '@/lib/raster-display';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-reconciliation.module.css';
export function DataRasterDisplay({
  locale,
  onApply,
}: {
  readonly locale: Locale;
  readonly onApply: (value: RasterDisplay | null) => void;
}) {
  const copy = getDictionary(locale).rasterDisplay;
  const [value, setValue] = useState<RasterDisplay | null>(null),
    [invalid, setInvalid] = useState(false);
  return (
    <div className={styles.body}>
      <details>
        <summary>{copy.settings}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const field = (name: string) => {
              const entry = form.get(name);
              return typeof entry === 'string' ? entry.trim() : '';
            };
            const next = rasterDisplay({
              band: field('band'),
              min: field('min'),
              max: field('max'),
              nodata: field('nodata'),
              unit: field('unit'),
            });
            if (!next) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            setValue(next);
            onApply(next);
          }}
        >
          <fieldset>
            <legend>{copy.settings}</legend>
            <p>{copy.hint}</p>
            {(['band', 'min', 'max', 'nodata', 'unit'] as const).map((name) => (
              <label key={name}>
                {copy[name]}
                <input
                  name={name}
                  defaultValue={name === 'band' ? '1' : ''}
                  required={['band', 'min', 'max'].includes(name)}
                  maxLength={name === 'unit' ? 80 : 40}
                />
              </label>
            ))}
            {invalid ? <p role="alert">{copy.invalid}</p> : null}
            <button type="submit">{copy.apply}</button>
            <button
              type="button"
              onClick={() => {
                setValue(null);
                setInvalid(false);
                onApply(null);
              }}
            >
              {copy.reset}
            </button>
          </fieldset>
        </form>
      </details>
      {value ? (
        <div aria-label={copy.legend}>
          <p>
            {copy.band} {value.band} ·{' '}
            {value.unit
              ? `${copy.declaredUnit}: ${value.unit}`
              : copy.unknownUnit}
          </p>
          <div
            role="img"
            aria-label={`${copy.legend}: ${value.min} – ${value.max}`}
            style={{
              height: 16,
              background:
                'linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)',
            }}
          />
          <p>
            {value.min} — {value.max}
          </p>
          <p>{copy.clipped}</p>
          <p>
            {value.nodata === undefined
              ? copy.sourceMask
              : `${copy.nodata}: ${value.nodata} · ${copy.transparent}`}
          </p>
        </div>
      ) : (
        <p>{copy.original}</p>
      )}
    </div>
  );
}
