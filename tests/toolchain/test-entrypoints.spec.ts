import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

describe('workspace test entrypoints', () => {
  it('routes the default test command through explicit unit and operations lanes', () => {
    const manifest = readJson('package.json');
    const scripts = manifest.scripts as Record<string, string>;

    expect(scripts.test).toBe('pnpm test:unit && pnpm test:ops');
    expect(scripts['test:unit']).toBe(
      "vitest run && pnpm --recursive --if-present --filter './apps/*' test",
    );
    expect(scripts['test:ops']).toBe(
      'node --test scripts/data-foundation/*.test.mjs',
    );
  });

  it('keeps every runnable application in an explicit automated test lane', () => {
    const applications = readdirSync(resolve(repositoryRoot, 'apps'))
      .filter((entry) =>
        statSync(resolve(repositoryRoot, 'apps', entry)).isDirectory(),
      )
      .map((entry) => {
        const manifest = readJson(`apps/${entry}/package.json`);
        const scripts = manifest.scripts as Record<string, string>;
        return {
          browser: typeof scripts['test:e2e'] === 'string',
          name: manifest.name,
          unit: typeof scripts.test === 'string',
        };
      })
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));

    expect(applications).toEqual([
      { browser: false, name: '@agent-excon/worker', unit: true },
      { browser: false, name: '@wiser/api', unit: true },
      { browser: false, name: '@wiser/data-worker', unit: true },
      { browser: true, name: '@wiser/docs', unit: false },
      { browser: false, name: '@wiser/mcp', unit: true },
      { browser: false, name: '@wiser/telemetry-ingress', unit: true },
      { browser: true, name: '@wiser/web', unit: true },
    ]);
  });

  it('makes the shared Data verification workflow reuse the operations lane', () => {
    const verification = read('scripts/data-foundation/verify.mjs');

    expect(verification).toContain(
      "await runCommand('pnpm', ['test:ops'], { capture: false });",
    );
    expect(verification).not.toContain("'--test'");
  });

  it('fails instead of accepting an empty root Vitest suite', () => {
    expect(read('vitest.config.ts')).toContain('passWithNoTests: false');
  });
});
