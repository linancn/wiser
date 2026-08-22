import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getRunById, getScenarioById } from '../lib/platform';
import { RunDiagnosticsPanel } from './run-diagnostics-panel';

describe('Run diagnostics panel', () => {
  it('renders authority and telemetry as separate Chinese-default evidence tracks', () => {
    const run = getRunById('run-yongding-spring-042');
    const scenario = getScenarioById('yongding-2023-ecological-replenishment');
    if (run === undefined || scenario === undefined) throw new Error('fixture');

    const html = renderToStaticMarkup(
      createElement(RunDiagnosticsPanel, {
        locale: 'zh-CN',
        run,
        scenario,
      }),
    );

    expect(html).toContain('评测结果与运行诊断');
    expect(html).toContain('4 / 4');
    expect(html).toContain('OUTPUT_SCHEMA_ADDITIONAL_PROPERTY');
    expect(html).toContain('analysis-ready');
    expect(html).toContain('endorsement-ready');
    expect(html).toContain('data-source="authoritative"');
    expect(html).toContain('data-source="telemetry"');
    expect(html).toContain('data-testid="diagnostic-summary"');
    expect(html.match(/data-testid="evaluation-row"/g)).toHaveLength(6);
    expect(html).toContain('Span 明细');
    expect(html).not.toContain('综合评分');
  });

  it('renders the same diagnostic topology in English', () => {
    const run = getRunById('run-yongding-spring-042');
    const scenario = getScenarioById('yongding-2023-ecological-replenishment');
    if (run === undefined || scenario === undefined) throw new Error('fixture');

    const html = renderToStaticMarkup(
      createElement(RunDiagnosticsPanel, {
        locale: 'en',
        run,
        scenario,
      }),
    );

    expect(html).toContain('Evaluation results and execution diagnostics');
    expect(html).toContain('Evaluation result');
    expect(html).toContain('Execution visibility');
    expect(html).toContain('Telemetry signal coverage');
  });
});
