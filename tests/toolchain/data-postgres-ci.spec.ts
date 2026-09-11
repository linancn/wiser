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

describe('Data PostgreSQL CI', () => {
  it('exposes focused deep-test commands without changing the default suite', () => {
    const manifest = readJson('package.json');
    const scripts = manifest.scripts as Record<string, string>;

    expect(scripts['test:postgres:data-api']).toBe(
      'pnpm --filter @wiser/api exec vitest run --config vitest.config.ts test/data-postgres-command-executors.spec.ts test/data-postgres-geo-query.spec.ts test/data-reconciliation.integration.spec.ts test/data-assessment.integration.spec.ts',
    );
    expect(scripts['test:postgres:data-worker']).toBe(
      'pnpm --filter @wiser/data-worker exec vitest run --config vitest.config.ts test/ingestion-runtime-adapters.spec.ts',
    );
    expect(scripts.test).toBe('pnpm test:unit && pnpm test:ops');
  });

  it('generates isolated credentials before the Data profile starts', () => {
    const job = dataFoundationJob();
    const credentials = job.indexOf(
      'name: Generate isolated Data PostgreSQL credentials',
    );
    const start = job.indexOf('run: pnpm data:up');

    expect(credentials).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(credentials);
    for (const name of [
      'DATA_POSTGRES_PASSWORD',
      'DATA_API_DATABASE_PASSWORD',
      'DATA_WORKER_DATABASE_PASSWORD',
      'DATA_GIS_DATABASE_PASSWORD',
      'DATA_TEST_DATABASE_URL',
      'DATA_WORKER_PG_SMOKE_URL',
    ]) {
      expect(job).toContain(name);
    }
    expect(job).toContain('::add-mask::');
    expect(job).toContain('>> "$GITHUB_ENV"');
    expect(job).not.toContain('wiser-local-data-');
    expect(job).not.toContain('wiser-local-worker-');
  });

  it('runs the API and Worker PostgreSQL gates after the vertical smoke and before cleanup', () => {
    const job = dataFoundationJob();
    const smoke = job.indexOf(
      'run: pnpm --silent data:smoke > "$RUNNER_TEMP/wiser-data-smoke.json"',
    );
    const apiStep = job.indexOf(
      'name: Verify Data API commands and geo queries against real PostgreSQL',
    );
    const api = job.indexOf('run: pnpm test:postgres:data-api');
    const worker = job.indexOf('run: pnpm test:postgres:data-worker');
    const cleanup = job.indexOf(
      'docker compose --profile data-foundation down --volumes --remove-orphans',
    );

    expect(smoke).toBeGreaterThan(-1);
    expect(api).toBeGreaterThan(smoke);
    expect(worker).toBeGreaterThan(api);
    expect(cleanup).toBeGreaterThan(worker);
    expect(apiStep).toBeGreaterThan(smoke);
    expect(job.slice(apiStep, worker)).toContain(
      "WISER_DATA_PG_INTEGRATION: '1'",
    );
    expect(job).toContain('if: always()');
  });

  it('documents that deep PostgreSQL commands require disposable state', () => {
    const chinese = read(
      'apps/docs/src/content/docs/zh-CN/development/testing.md',
    );
    const english = read(
      'apps/docs/src/content/docs/en/development/testing.md',
    );

    for (const document of [chinese, english]) {
      expect(document).toContain('pnpm test:postgres:data-api');
      expect(document).toContain('pnpm test:postgres:data-worker');
    }
    expect(chinese).toContain('可丢弃');
    expect(english).toContain('disposable');
  });
});
