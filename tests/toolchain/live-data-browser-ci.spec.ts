import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

function dataFoundationJob(): string {
  const workflow = read('.github/workflows/ci.yml');
  const start = workflow.indexOf('\n  data-foundation:');
  const end = workflow.indexOf('\n  observability:', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('authenticated Data browser CI', () => {
  it('keeps the production-shaped suite explicit and serial', () => {
    const root = readJson('package.json');
    const rootScripts = root.scripts as Record<string, string>;
    const web = readJson('apps/web/package.json');
    const webScripts = web.scripts as Record<string, string>;
    const referenceConfig = read('apps/web/playwright.config.ts');
    const liveConfig = read('apps/web/playwright.live.config.ts');

    expect(rootScripts['test:e2e:data-live']).toBe(
      'pnpm --filter @wiser/web test:e2e:data-live',
    );
    expect(webScripts['test:e2e:data-live']).toBe(
      'playwright test --config playwright.live.config.ts',
    );
    expect(webScripts['test:e2e']).toBe('playwright test');
    expect(referenceConfig).toContain("baseURL: 'http://127.0.0.1:3100'");
    expect(referenceConfig).not.toContain('e2e-live');
    expect(liveConfig).toContain("testDir: './e2e-live'");
    expect(liveConfig).toContain('WISER_WEB_LIVE_BASE_URL');
    expect(liveConfig).toContain('fullyParallel: false');
    expect(liveConfig).toContain('workers: 1');
    expect(liveConfig).toContain("outputDir: 'test-results-live'");
    expect(liveConfig).toContain("outputFolder: 'playwright-report-live'");
    expect(liveConfig).toContain("trace: 'off'");
    expect(liveConfig).toContain("video: 'off'");
    expect(liveConfig).not.toContain('webServer:');
  });

  it('reuses the Data stack after smoke and retains failure diagnostics', () => {
    const job = dataFoundationJob();
    const install = job.indexOf(
      'name: Install Chromium for authenticated Data browser checks',
    );
    const start = job.indexOf('run: pnpm data:up');
    const smoke = job.indexOf('run: pnpm data:smoke');
    const browserStep = job.indexOf(
      'name: Verify authenticated Data browser flow',
    );
    const browser = job.indexOf('run: pnpm test:e2e:data-live');
    const api = job.indexOf('run: pnpm test:postgres:data-api');
    const artifact = job.indexOf(
      'name: Upload failed authenticated Data browser diagnostics',
    );
    const cleanup = job.indexOf(
      'docker compose --profile data-foundation down --volumes --remove-orphans',
    );

    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(start);
    expect(browserStep).toBeGreaterThan(smoke);
    expect(browser).toBeGreaterThan(browserStep);
    expect(api).toBeGreaterThan(browser);
    expect(artifact).toBeGreaterThan(browser);
    expect(cleanup).toBeGreaterThan(artifact);
    expect(job.slice(browserStep, browser)).toContain(
      'WISER_WEB_LIVE_BASE_URL: http://127.0.0.1:3000',
    );
    expect(job.slice(browserStep, browser)).toContain(
      'WISER_WEB_LIVE_EMAIL: operator@agent-excon.test',
    );
    expect(job.slice(browserStep, browser)).toContain(
      'WISER_WEB_LIVE_PASSWORD: WiserLocalOperator-2026!',
    );
    expect(job.slice(browserStep, browser)).toContain(
      'WISER_WEB_LIVE_SMOKE_REPORT: ${{ runner.temp }}/wiser-data-smoke.json',
    );
    expect(job).toContain(
      'pnpm --silent data:smoke > "$RUNNER_TEMP/wiser-data-smoke.json"',
    );
    expect(job.slice(artifact, cleanup)).toContain('if: failure()');
    expect(job.slice(artifact, cleanup)).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(job.slice(artifact, cleanup)).toContain(
      'apps/web/test-results-live/',
    );
    expect(job.slice(artifact, cleanup)).toContain(
      'apps/web/playwright-report-live/',
    );
  });

  it('documents the real Auth and authority boundary in both locales', () => {
    const chinese = read(
      'apps/docs/src/content/docs/zh-CN/development/testing.md',
    );
    const english = read(
      'apps/docs/src/content/docs/en/development/testing.md',
    );

    for (const document of [chinese, english]) {
      expect(document).toContain('pnpm test:e2e:data-live');
      expect(document).toContain('WISER_WEB_LIVE_BASE_URL');
    }
    expect(chinese).toContain('真实 Supabase Session');
    expect(english).toContain('real Supabase session');
  });
});
