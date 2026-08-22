import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  getReferenceInteractions,
  getRunById,
  getScenarioById,
} from '../lib/platform';
import { RunOverview } from './run-overview';

describe('Run overview', () => {
  it('puts authority, risk, next action, and the decision spine before technical detail', () => {
    const run = getRunById('run-yongding-spring-042');
    const scenario = getScenarioById('yongding-2023-ecological-replenishment');
    if (run === undefined || scenario === undefined) throw new Error('fixture');

    const html = renderToStaticMarkup(
      createElement(RunOverview, {
        interactions: getReferenceInteractions(run.id),
        locale: 'zh-CN',
        run,
        scenario,
      }),
    );

    expect(html).toContain('运行概览');
    expect(html).toContain('裁决通过');
    expect(html).toContain('遥测有缺口');
    expect(html).toContain('待办与风险');
    expect(html).toContain('data-testid="run-decision-spine"');
    expect(html.match(/data-testid="decision-node"/g)).toHaveLength(7);
    expect(
      html.match(/data-testid="attention-item"/g)?.length,
    ).toBeLessThanOrEqual(3);
    expect(html).toContain(`/zh-CN/runs/${run.id}/diagnostics`);
    expect(html).toContain(`/zh-CN/runs/${run.id}/trace`);
    expect(html).toContain(`/zh-CN/runs/${run.id}/replay`);
    expect(html).toContain(`/zh-CN/runs/${run.id}/collaboration`);
    expect(html).toContain('<strong>3</strong> 个专业工件已交接');
  });
});
