import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getShowcaseStatus,
  requestShowcaseStop,
  runShowcasePreflight,
  startShowcaseSupervisor,
  waitForHttpReady,
} from '../../cookbooks/workbuddy-yongding-tdd/showcase/scripts/supervisor.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryStateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wiser-showcase-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('WISER WorkBuddy showcase supervisor', () => {
  it('preflights scripted and WorkBuddy profiles without exposing private configuration', async () => {
    const stateDirectory = await temporaryStateDirectory();
    const repositoryRoot = resolve(import.meta.dirname, '../..');

    const scripted = await runShowcasePreflight({
      environment: { NODE_ENV: 'test' },
      profile: 'scripted',
      repositoryRoot,
      stateDirectory,
    });
    expect(scripted).toMatchObject({ ok: true, profile: 'scripted' });
    expect(scripted.checks.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['node', 'next', 'session', 'state-directory']),
    );
    expect(JSON.stringify(scripted)).not.toMatch(/token|mcpConfigPath|\.mcp/i);

    const workbuddy = await runShowcasePreflight(
      {
        environment: { NODE_ENV: 'test', WORKBUDDY_LIVE: '1' },
        profile: 'workbuddy',
        repositoryRoot,
        stateDirectory,
      },
      {
        workBuddyCli:
          '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
        access: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      },
    );
    expect(workbuddy.ok).toBe(false);
    expect(workbuddy.checks).toContainEqual(
      expect.objectContaining({ id: 'workbuddy-cli', ok: false }),
    );
  });

  it('keeps one Lab and live Web child alive through the observation hook, then scrubs secrets on TTL cleanup', async () => {
    const stateDirectory = await temporaryStateDirectory();
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const operatorToken = 'wbl_operator-secret-must-not-persist';
    const mcpConfigPath = '/private/runtime/workbuddy/mcp/agent.json';
    const webStops: string[] = [];
    const phases: string[] = [];

    const result = await startShowcaseSupervisor(
      {
        environment: { NODE_ENV: 'test' },
        profile: 'rework',
        repositoryRoot,
        stateDirectory,
        ttlMs: 25,
      },
      {
        runCookbook: async (options) => {
          expect(options.mode).toBe('scripted');
          expect(options.faultInjection).toBe('water-evidence-schema-once');
          await options.onLabReady?.({
            apiBaseUrl: 'http://127.0.0.1:4101/api/v2/',
            operatorToken,
            runId: '11111111-1111-4111-8111-111111111111',
            scenarioVersionId: 'scenario-yongding-v2',
            roster: [],
            privateRuntime: { mcpConfigPath },
          });
          phases.push('lab-ready');
          const running = JSON.parse(
            await readFile(join(stateDirectory, 'showcase-session.json'), 'utf8'),
          );
          expect(running).toMatchObject({
            state: 'running',
            profile: 'rework',
            runId: '11111111-1111-4111-8111-111111111111',
            webUrl: 'http://127.0.0.1:4201',
          });
          await options.onObservationReady?.({
            evaluations: [],
            events: { eventCount: 12, lastRunSeq: 12, releasedBarriers: [] },
            interactions: {
              acknowledgedDeliveryCount: 2,
              handoffCount: 1,
              interactionCount: 3,
              openRequestCount: 0,
              requestCount: 1,
              responseCount: 1,
            },
            participantResults: [],
            runId: '11111111-1111-4111-8111-111111111111',
          });
          phases.push('observation-finished');
          return {
            exitCode: 0,
            report: { status: 'passed' },
            reportPath: join(stateDirectory, 'cookbook-report.json'),
          };
        },
        startWeb: async ({ environment }) => {
          expect(environment.AGENT_EXCON_WEB_DATA_MODE).toBe('live');
          expect(environment.AGENT_EXCON_API_INTERNAL_URL).toBe(
            'http://127.0.0.1:4101/api/v2/',
          );
          expect(environment.WISER_WEB_OPERATOR_TOKEN).toBe(operatorToken);
          return {
            pid: 42_001,
            url: 'http://127.0.0.1:4201',
            stop: async (reason) => {
              webStops.push(reason);
            },
          };
        },
        waitForWeb: () => Promise.resolve(),
      },
    );

    expect(result.reason).toBe('ttl');
    expect(phases).toEqual(['lab-ready', 'observation-finished']);
    expect(webStops).toEqual(['ttl']);
    const sessionPath = join(stateDirectory, 'showcase-session.json');
    const serialized = await readFile(sessionPath, 'utf8');
    const session = JSON.parse(serialized);
    expect(session).toMatchObject({ state: 'stopped', stopReason: 'ttl' });
    expect(serialized).not.toContain(operatorToken);
    expect(serialized).not.toContain(mcpConfigPath);
    expect(serialized).not.toMatch(/WISER_WEB_OPERATOR_TOKEN|mcp/i);
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
  });

  it('reports the active session and sends one bounded SIGTERM for stop', async () => {
    const stateDirectory = await temporaryStateDirectory();
    const sessionPath = join(stateDirectory, 'showcase-session.json');
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        schemaVersion: 1,
        sessionId: 'showcase-test',
        state: 'running',
        profile: 'scripted',
        supervisorPid: 42_002,
        webPid: 42_003,
        runId: '11111111-1111-4111-8111-111111111111',
        scenarioVersionId: 'scenario-yongding-v2',
        webUrl: 'http://127.0.0.1:4202',
        apiUrl: 'http://127.0.0.1:4102',
        startedAt: '2026-08-21T00:00:00.000Z',
        expiresAt: '2026-08-21T00:15:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
        stopReason: null,
        observation: null,
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(sessionPath, 0o600);
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const status = await getShowcaseStatus(
      { stateDirectory },
      {
        isProcessAlive: (pid) => pid === 42_002,
        probe: () => Promise.resolve({ ok: true, status: 200 }),
      },
    );
    expect(status).toMatchObject({ active: true, webReachable: true });

    const stopped = await requestShowcaseStop(
      { stateDirectory },
      {
        isProcessAlive: () => true,
        killProcess: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
    );
    expect(stopped).toMatchObject({ state: 'stopping', signalled: true });
    expect(signals).toEqual([{ pid: 42_002, signal: 'SIGTERM' }]);
  });

  it('never retries an HTTP 429 while waiting for readiness', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response('rate limited', { status: 429 })),
    );

    await expect(
      waitForHttpReady('http://127.0.0.1:4200/health', {
        fetcher,
        pause: () => Promise.resolve(),
        attempts: 5,
      }),
    ).rejects.toThrow(/429/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
