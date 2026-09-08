'use client';
import { useEffect, useRef } from 'react';
import { init, use } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ExplorationAggregate } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';
use([BarChart, AriaComponent, GridComponent, TooltipComponent, SVGRenderer]);
export function DataExplorerAggregateChart({
  locale,
  result,
  onPick,
}: {
  readonly locale: Locale;
  readonly result: ExplorationAggregate;
  readonly onPick: (group: ExplorationAggregate['groups'][number]) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.aggregate;
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onPick);
  latest.current = onPick;
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
    const draw = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (key: string) => tokens.getPropertyValue(key).trim();
      chart.setOption(
        {
          animation: !window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches,
          animationDuration: 150,
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
            bottom: 25,
            containLabel: true,
          },
          tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
          xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {
              color: color('--text-secondary'),
              width: 90,
              overflow: 'truncate',
            },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: color('--text-secondary') },
            splitLine: { lineStyle: { color: color('--border') } },
          },
          series: [
            {
              type: 'bar',
              barMaxWidth: 48,
              itemStyle: { color: color('--accent-strong') },
              data: result.groups.map((group) =>
                group.value !== null && Number.isFinite(Number(group.value))
                  ? Number(group.value)
                  : null,
              ),
            },
          ],
        },
        { notMerge: true },
      );
      element.dataset.state = 'ready';
    };
    chart.on('click', (event: unknown) => {
      if (
        typeof event === 'object' &&
        event !== null &&
        'dataIndex' in event &&
        typeof event.dataIndex === 'number'
      ) {
        const group = result.groups[event.dataIndex];
        if (group) latest.current(group);
      }
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
