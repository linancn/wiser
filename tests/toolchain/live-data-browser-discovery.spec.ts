import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const cli = createRequire(resolve(root, 'apps/web/package.json')).resolve(
  '@playwright/test/cli',
);

it('discovers the CI browser suite without private case URLs', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'wiser-browser-discovery-'));
  const report = resolve(directory, 'smoke.json');
  // A synthetic receipt is sufficient for discovery; no browser or service runs.
  const steps = [
    'upload-session-created',
    'fixtures-uploaded',
    'ingestion-created',
    'clamav-security-scan',
    'sha256-fingerprints',
    'fixtures-parsed',
    'fake-ai-plan',
    'deterministic-transform',
    'quality-checks',
    'authority-version-committed',
    'raw-objects-promoted',
    'transactional-outbox-written',
    'five-projections-built',
    'projection-status-succeeded',
    'rest-query',
    'graphql-query',
    'mcp-query',
    'web-catalog',
  ];
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  writeFileSync(
    report,
    JSON.stringify({
      status: 'ok',
      vertical: {
        status: 'ok',
        dataItemId: id,
        ingestionId: id,
        operationId: id,
        versionId: id,
        steps: steps.map((name, index) => ({
          number: index + 1,
          id: name,
          status: 'ok',
        })),
      },
    }),
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WISER_WEB_LIVE_BASE_URL: 'http://127.0.0.1:3100',
    WISER_WEB_LIVE_EMAIL: 'discovery@example.test',
    WISER_WEB_LIVE_PASSWORD: 'discovery-only',
    WISER_WEB_LIVE_SMOKE_REPORT: report,
  };
  delete env.WISER_WEB_LIVE_RELATION_URL;
  delete env.WISER_WEB_LIVE_RECORD_URL;
  delete env.WISER_WEB_LIVE_OBSERVATION_COUNT;
  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'test',
        '--config',
        'playwright.live.config.ts',
        '--list',
        '--reporter=list',
      ],
      {
        cwd: resolve(root, 'apps/web'),
        env,
        encoding: 'utf8',
        timeout: 20000,
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    for (const file of [
      'authenticated-data.spec.ts',
      'data-foundation-product.spec.ts',
      'exploration-saved.spec.ts',
      'query-visualization.spec.ts',
    ])
      expect(result.stdout).toContain(file);
    for (const name of [
      'business-record-navigation',
      'business-relation-navigation',
      'exploration-record-focus',
    ])
      expect(result.stdout).not.toContain(name);

    const listCases = () =>
      spawnSync(
        process.execPath,
        [
          cli,
          'test',
          '--config',
          'playwright.case.config.ts',
          '--list',
          '--reporter=list',
        ],
        {
          cwd: resolve(root, 'apps/web'),
          env,
          encoding: 'utf8',
          timeout: 20000,
        },
      );
    const missingCase = listCases();
    expect(missingCase.status).not.toBe(0);
    expect(missingCase.stdout + missingCase.stderr).toContain('case');
    const origin = env.WISER_WEB_LIVE_BASE_URL!;
    env.WISER_WEB_LIVE_RELATION_URL = `${origin}/zh-CN/data-foundation/catalog/${id}?version=${id}&relations=%7B%7D`;
    env.WISER_WEB_LIVE_RECORD_URL = `${origin}/zh-CN/data-foundation/explore?recordFocus=${encodeURIComponent(JSON.stringify({ dataItemId: id, versionId: id, recordId: id }))}`;
    env.WISER_WEB_LIVE_OBSERVATION_COUNT = '2';
    const cases = listCases();
    expect(cases.status, cases.stdout + cases.stderr).toBe(0);
    for (const name of [
      'business-record-navigation.case.ts',
      'business-relation-navigation.case.ts',
      'exploration-record-focus.case.ts',
      'exploration-workspace.case.ts',
    ])
      expect(cases.stdout).toContain(name);
    expect(cases.stdout).toContain(
      'retains real public spatial anchors and unlocated evidence across presentation changes',
    );
    expect(cases.stdout).toContain(
      'applies a real public monthly period consistently across graph, records, map and refresh',
    );
    expect(cases.stdout).toContain('Total: 8 tests in 4 files');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
