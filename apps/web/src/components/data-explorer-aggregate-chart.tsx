'use client';
import { useEffect, useRef } from 'react';
import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  BrushComponent,
  LegendComponent,
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ExplorationAggregate } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';
use([
  BarChart,
  LineChart,
  BrushComponent,
  LegendComponent,
  AriaComponent,
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
  SVGRenderer,
]);
export function DataExplorerAggregateChart({
  locale,
  result,
  onPick,
  onRange,
}: {
  readonly locale: Locale;
  readonly result: ExplorationAggregate;
  readonly onPick: (group: ExplorationAggregate['groups'][number]) => void;
  readonly onRange?: (first: string, last: string) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.aggregate;
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onPick);
  latest.current = onPick;
  const latestRange = useRef(onRange);
  latestRange.current = onRange;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'svg' });
    const labels = result.groups.map((group) =>
      [
        group.key ?? (result.spec.groupBy ? copy.unknownGroup : copy.ungrouped),
        group.unit,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    const time =
      result.spec.groupBy?.type === 'time' ? result.spec.groupBy : null;
    const timed = time
      ? result.groups.filter(
          (group) =>
            group.key !== null &&
            group.upperBound !== null &&
            Number.isFinite(Date.parse(group.key)),
        )
      : [];
    const units = [...new Set(timed.map((group) => group.unit))];
    const seriesGroups = time
      ? units.map((unit) => timed.filter((group) => group.unit === unit))
      : [result.groups];
    const number = (group: ExplorationAggregate['groups'][number]) =>
      group.value !== null && Number.isFinite(Number(group.value))
        ? Number(group.value)
        : null;
    const timeLabel = (value: number) =>
      new Date(value + (time?.utcOffsetMinutes ?? 0) * 60000)
        .toISOString()
        .slice(
          0,
          time?.bucket === 'year'
            ? 4
            : time?.bucket === 'month'
              ? 7
              : time?.bucket === 'day'
                ? 10
                : 16,
        )
        .replace('T', ' ');
    const draw = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (key: string) => tokens.getPropertyValue(key).trim();
      chart.setOption(
        {
          animation: !window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches,
          animationDuration: 150,
          useUTC: true,
          color: [
            color('--accent-strong'),
            color('--success-strong'),
            color('--warning-bright'),
          ],
          toolbox: { show: false },
          ...(time
            ? {
                brush: {
                  xAxisIndex: 0,
                  brushType: 'lineX',
                  brushMode: 'single',
                  toolbox: [],
                },
                legend: {
                  type: 'scroll',
                  bottom: 0,
                  textStyle: { color: color('--text-secondary') },
                },
              }
            : {}),
          aria: {
            enabled: true,
            label: {
              description: `${copy.title}: ${copy.operations[result.spec.measure.operation]}`,
            },
          },
          grid: {
            left: 12,
            right: 30,
            top: 20,
            bottom: time ? 55 : 25,
            containLabel: true,
          },
          tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
          xAxis: {
            type: time ? 'time' : 'category',
            ...(time ? {} : { data: labels }),
            axisLabel: {
              color: color('--text-secondary'),
              ...(time ? { formatter: timeLabel } : {}),
              width: 90,
              overflow: 'truncate',
            },
          },
          yAxis: {
            type: 'value',
            ...(result.spec.measure.operation === 'count'
              ? { minInterval: 1 }
              : {}),
            axisLabel: { color: color('--text-secondary') },
            splitLine: { lineStyle: { color: color('--border') } },
          },
          series: seriesGroups.map((groups, index) => ({
            type: time ? 'line' : 'bar',
            ...(time
              ? {
                  name:
                    units[index] ??
                    (result.spec.measure.operation === 'count'
                      ? copy.operations.count
                      : copy.unknownUnit),
                  connectNulls: false,
                  showSymbol: groups.length <= 100,
                }
              : {
                  barMaxWidth: 48,
                  itemStyle: { color: color('--accent-strong') },
                }),
            data: groups.map((group) =>
              time ? [Date.parse(group.key!), number(group)] : number(group),
            ),
          })),
        },
        { notMerge: true },
      );
      if (time)
        chart.dispatchAction({
          type: 'takeGlobalCursor',
          key: 'brush',
          brushOption: { brushType: 'lineX', brushMode: 'single' },
        });
      element.dataset.state = 'ready';
    };
    chart.on('click', (event: unknown) => {
      if (
        typeof event === 'object' &&
        event !== null &&
        'dataIndex' in event &&
        typeof event.dataIndex === 'number'
      ) {
        const series =
          'seriesIndex' in event && typeof event.seriesIndex === 'number'
            ? event.seriesIndex
            : 0;
        const group = seriesGroups[series]?.[event.dataIndex];
        if (group) latest.current(group);
      }
    });
    if (time)
      chart.on('brushEnd', (event: unknown) => {
        if (
          typeof event !== 'object' ||
          event === null ||
          !('areas' in event) ||
          !Array.isArray(event.areas)
        )
          return;
        const area: unknown = event.areas[0];
        if (
          typeof area !== 'object' ||
          area === null ||
          !('coordRange' in area) ||
          !Array.isArray(area.coordRange) ||
          area.coordRange.length !== 2
        )
          return;
        const a: unknown = area.coordRange[0];
        const b: unknown = area.coordRange[1];
        if (
          typeof a !== 'number' ||
          typeof b !== 'number' ||
          !Number.isFinite(a) ||
          !Number.isFinite(b)
        )
          return;
        const selected = timed.filter(
          (group) =>
            Date.parse(group.key!) <= Math.max(a, b) &&
            Date.parse(group.upperBound!) > Math.min(a, b),
        );
        const first = selected[0]?.key,
          last = selected.at(-1)?.key;
        if (first && last) latestRange.current?.(first, last);
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
  }, [result, copy]);
  return (
    <div
      ref={container}
      role="img"
      aria-label={copy.title}
      className={styles.statisticsCanvas}
      data-testid="explorer-aggregate-chart"
      data-state="idle"
    />
  );
}
