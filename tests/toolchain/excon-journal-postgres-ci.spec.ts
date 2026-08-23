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

function databaseJob(): string {
  const workflow = read('.github/workflows/ci.yml');
  const start = workflow.indexOf('\n  database:');
  const end = workflow.indexOf('\n  data-foundation:', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('Agent EXCON PostgreSQL journal CI', () => {
  it('keeps the deep suite explicit and outside the default unit lane', () => {
    const root = readJson('package.json');
    const rootScripts = root.scripts as Record<string, string>;
    const api = readJson('apps/api/package.json');
    const apiScripts = api.scripts as Record<string, string>;
    const defaultConfig = read('apps/api/vitest.config.ts');
    const postgresConfig = read('apps/api/vitest.postgres.config.ts');
    const tsconfig = read('apps/api/tsconfig.json');

    expect(rootScripts['test:postgres:excon-v2']).toBe(
      'pnpm --filter @wiser/api test:postgres:excon-v2',
    );
    expect(apiScripts['test:postgres:excon-v2']).toBe(
      'vitest run --config vitest.postgres.config.ts',
    );
    expect(rootScripts.test).toBe('pnpm test:unit && pnpm test:ops');
    expect(defaultConfig).toContain("include: ['test/**/*.spec.ts']");
    expect(defaultConfig).not.toContain('integration/');
    expect(postgresConfig).toContain(
      "include: ['integration/v2-postgres-journal-service.spec.ts']",
    );
    expect(postgresConfig).toContain('fileParallelism: false');
    expect(postgresConfig).toContain('passWithNoTests: false');
    expect(tsconfig).toContain('integration/**/*.ts');
    expect(tsconfig).toContain('vitest.postgres.config.ts');
  });

  it('runs after Supabase verification and before unconditional cleanup', () => {
    const job = databaseJob();
    const verify = job.indexOf('run: pnpm supabase:verify');
    const journalStep = job.indexOf(
      'name: Verify durable Agent EXCON journal against real PostgreSQL',
    );
    const journal = job.indexOf('run: pnpm test:postgres:excon-v2');
    const stop = job.indexOf('run: pnpm supabase:stop || true');

    expect(verify).toBeGreaterThan(-1);
    expect(journalStep).toBeGreaterThan(verify);
    expect(journal).toBeGreaterThan(journalStep);
    expect(stop).toBeGreaterThan(journal);
    expect(job.slice(journalStep, journal)).toContain(
      'EXCON_JOURNAL_TEST_ADMIN_URL: postgresql://postgres:postgres@127.0.0.1:56322/postgres',
    );
    expect(job.slice(journalStep, stop)).not.toContain(
      'EXCON_JOURNAL_DATABASE_URL',
    );
    expect(job.slice(journal, stop)).toContain('if: always()');
  });

  it('documents the disposable database boundary in both locales', () => {
    const chinese = read(
      'apps/docs/src/content/docs/zh-CN/development/testing.md',
    );
    const english = read(
      'apps/docs/src/content/docs/en/development/testing.md',
    );

    for (const document of [chinese, english]) {
      expect(document).toContain('pnpm test:postgres:excon-v2');
      expect(document).toContain('EXCON_JOURNAL_TEST_ADMIN_URL');
    }
    expect(chinese).toContain('临时数据库');
    expect(english).toContain('ephemeral database');
  });
});
