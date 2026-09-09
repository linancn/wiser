'use client';

import { useEffect, useRef, useState } from 'react';
import { init, use } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type {
  ExplorationReadiness,
  ExplorationSummary,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';

use([BarChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);
export function DataExplorerStatistics({
  summary,
  locale,
  onFilter,
}: {
  readonly summary: ExplorationSummary;
  readonly locale: Locale;
  readonly onFilter: (
    dimension: 'records' | 'spatial',
    status: ExplorationReadiness,
  ) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [dimension, setDimension] = useState<'records' | 'spatial'>('records');
  const container = useRef<HTMLDivElement>(null);
  const latestFilter = useRef(onFilter);
  useEffect(() => {
    latestFilter.current = onFilter;
  }, [onFilter]);
  const rows = summary[dimension];
  const number = new Intl.NumberFormat(locale);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'svg' });
    const draw = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (name: string) => tokens.getPropertyValue(name).trim();
      chart.setOption(
        {
          animation: !window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches,
          animationDuration: 150,
          aria: {
            enabled: true,
            label: {
              description: `${copy.statisticsView}: ${rows.map((row) => `${copy.readiness[row.status]} ${row.count}`).join(', ')}`,
            },
          },
          grid: {
            left: 12,
            right: 36,
            top: 20,
            bottom: 20,
            containLabel: true,
          },
          tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
          xAxis: {
            type: 'value',
            minInterval: 1,
            axisLabel: { color: color('--text-secondary') },
            splitLine: { lineStyle: { color: color('--border') } },
          },
          yAxis: {
            type: 'category',
            inverse: true,
            data: rows.map((row) => copy.readiness[row.status]),
            axisLabel: {
              color: color('--text-primary'),
              width: 120,
              overflow: 'break',
            },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          series: [
            {
              type: 'bar',
              data: rows.map((row) => row.count),
              barMaxWidth: 36,
              itemStyle: {
                color: color('--accent-strong'),
                borderRadius: [0, 4, 4, 0],
              },
              label: {
                show: true,
                position: 'right',
                color: color('--text-primary'),
              },
            },
          ],
        },
        { notMerge: true },
      );
      element.dataset.state = 'ready';
    };
    chart.on('click', (event: unknown) => {
      if (
        typeof event !== 'object' ||
        event === null ||
        !('dataIndex' in event) ||
        typeof event.dataIndex !== 'number'
      )
        return;
      const row = rows[event.dataIndex];
      if (row) latestFilter.current(dimension, row.status);
    });
    draw();
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
      element.dataset.state = 'idle';
    };
  }, [copy, dimension, rows]);
  return (
    <div className={styles.statistics}>
      <div className={styles.recordToolbar}>
        <label>
          <span>{copy.statisticsDimension}</span>
          <select
            value={dimension}
            onChange={(event) =>
              setDimension(
                event.target.value === 'spatial' ? 'spatial' : 'records',
              )
            }
          >
            <option value="records">{copy.recordReadiness}</option>
            <option value="spatial">{copy.spatialReadiness}</option>
          </select>
        </label>
        <span>
          {copy.statisticsScope} · {number.format(summary.resourceCount)}
        </span>
      </div>
      <div
        ref={container}
        role="img"
        aria-label={copy.statisticsView}
        data-testid="explorer-statistics-chart"
        data-state="idle"
        className={styles.statisticsCanvas}
      />
      <p>{copy.statisticsHint}</p>
      <ul className={styles.statisticsList}>
        {rows.map((row) => (
          <li key={row.status}>
            <button
              type="button"
              onClick={() => onFilter(dimension, row.status)}
            >
              {copy.readiness[row.status]} · {number.format(row.count)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
