import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const uploadArtifactCommit = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

describe('reference browser CI', () => {
  it('provides one reproducible root command for both browser suites', () => {
    const manifest = readJson('package.json');
    const scripts = manifest.scripts as Record<string, string>;

    expect(scripts['test:e2e:reference']).toBe(
      'pnpm --workspace-concurrency=1 --no-bail --filter @wiser/web --filter @wiser/docs run test:e2e',
    );
  });

  it('captures screenshots, traces, and HTML diagnostics on failure', () => {
    for (const path of [
      'apps/web/playwright.config.ts',
      'apps/docs/playwright.config.ts',
    ]) {
      const config = read(path);
      expect(config, path).toContain('forbidOnly: Boolean(process.env.CI)');
      expect(config, path).toContain("screenshot: 'only-on-failure'");
      expect(config, path).toContain("trace: 'retain-on-failure'");
      expect(config, path).toContain("['html', { open: 'never' }]");
    }
  });

  it('starts isolated Next servers without inheriting conflicting script ports', () => {
    expect(read('apps/web/playwright.config.ts')).toContain(
      "command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3100'",
    );
    expect(read('apps/docs/playwright.config.ts')).toContain(
      "command: 'pnpm exec next dev --hostname 127.0.0.1 --port 4322'",
    );
  });

  it('runs the reference suites after verify and retains only failed-run artifacts', () => {
    const workflow = read('.github/workflows/ci.yml');
    const start = workflow.indexOf('\n  browser:');
    const end = workflow.indexOf('\n  database:', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const browser = workflow.slice(start, end);
    expect(browser).toContain('needs: verify');
    expect(browser).toContain(
      'pnpm --filter @wiser/web exec playwright install --with-deps chromium',
    );
    expect(browser).toContain('run: pnpm test:e2e:reference');
    expect(browser).toContain(
      `uses: actions/upload-artifact@${uploadArtifactCommit} # v7.0.1`,
    );
    expect(browser).toContain('if: failure()');
    expect(browser).toContain('apps/web/test-results/');
    expect(browser).toContain('apps/docs/test-results/');
    expect(browser).toContain('apps/web/playwright-report/');
    expect(browser).toContain('apps/docs/playwright-report/');
    expect(browser).toContain('if-no-files-found: warn');
    expect(browser).toContain('retention-days: 7');
    for (const duplicateGate of [
      'run: pnpm verify',
      'pnpm data:',
      'pnpm supabase:',
      'docker compose',
      'pnpm build',
    ]) {
      expect(browser).not.toContain(duplicateGate);
    }
  });

  it('documents the real isolated ports and the reference-only boundary', () => {
    const chinese = read(
      'apps/docs/src/content/docs/zh-CN/development/testing.md',
    );
    const english = read(
      'apps/docs/src/content/docs/en/development/testing.md',
    );

    for (const document of [chinese, english]) {
      expect(document).toContain('pnpm test:e2e:reference');
      expect(document).toContain('127.0.0.1:3100');
      expect(document).toContain('127.0.0.1:4322');
    }
    expect(chinese).toContain('reference/Auth-off');
    expect(english).toContain('reference/Auth-off');
  });
});
