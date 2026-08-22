import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startV2LocalLabServer } from '../../apps/api/src/index.js';
import { launchWorkBuddyRoles } from '../../examples/agent-excon/workbuddy-yongding-tdd/scripts/launch-four-agents.mjs';
import { renderWorkBuddyRuntime } from '../../examples/agent-excon/workbuddy-yongding-tdd/scripts/render-workbuddy-config.mjs';
import {
  RunEvaluationListSchema,
  RunInteractionListSchema,
} from '../../packages/contracts/src/index.js';

const temporaryDirectories: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve a loopback port.');
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

describe('scripted four-agent Yongding lab', () => {
  it('completes the specialist barrier, exact endorsements, and team evaluation through MCP', async () => {
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const parent = await mkdtemp(join(tmpdir(), 'wiser-scripted-lab-test-'));
    temporaryDirectories.push(parent);
    const port = await freeLoopbackPort();
    const labRuntimeDirectory = join(parent, 'lab');
    const server = await startV2LocalLabServer({
      config: {
        host: '127.0.0.1',
        port,
        apiBaseUrl: `http://127.0.0.1:${port}/api/v2/`,
        runtimeDirectory: labRuntimeDirectory,
      },
      environment: { NODE_ENV: 'test' },
    });
    closeCallbacks.push(() => server.close());
    const rendered = await renderWorkBuddyRuntime({
      labManifestPath: server.bundle.manifestPath,
      nodeExecutable: process.execPath,
      outputDirectory: join(parent, 'workbuddy'),
      repositoryRoot,
      workBuddyCli:
        '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      mcpCommand: join(repositoryRoot, 'node_modules/.bin/tsx'),
      mcpArguments: [join(repositoryRoot, 'apps/mcp/src/index.ts')],
    });

    const launched = await launchWorkBuddyRoles({
      environment: process.env,
      launchManifestPath: rendered.launchManifestPath,
      mode: 'scripted',
      repositoryRoot,
      timeoutMs: 30_000,
    });

    expect(
      launched.exitCode,
      JSON.stringify(launched.report.results, null, 2),
    ).toBe(0);
    expect(launched.report.results).toHaveLength(4);
    expect(
      launched.report.results.every(({ status }) => status === 'completed'),
    ).toBe(true);

    const evaluations = await server.app.inject({
      method: 'GET',
      url: `/api/v2/runs/${server.lab.manifest.runId}/evaluations`,
      headers: { authorization: `Bearer ${server.lab.operatorToken}` },
    });
    expect(evaluations.statusCode).toBe(200);
    const evaluationSummary = RunEvaluationListSchema.parse(
      evaluations.json(),
    ).items.map(({ roleSlotId, targetScope, verdict }) => ({
      roleSlotId,
      targetScope,
      verdict,
    }));
    expect(evaluationSummary).toHaveLength(4);
    expect(evaluationSummary).toEqual(
      expect.arrayContaining([
        {
          roleSlotId: 'water-evidence',
          targetScope: 'role',
          verdict: 'ACCEPTED',
        },
        {
          roleSlotId: 'hydraulic-constraints',
          targetScope: 'role',
          verdict: 'ACCEPTED',
        },
        {
          roleSlotId: 'ecological-target',
          targetScope: 'role',
          verdict: 'ACCEPTED',
        },
        {
          roleSlotId: 'dispatch-coordination',
          targetScope: 'team',
          verdict: 'ACCEPTED',
        },
      ]),
    );

    const interactions = RunInteractionListSchema.parse(
      (
        await server.app.inject({
          method: 'GET',
          url: `/api/v2/runs/${server.lab.manifest.runId}/interactions`,
          headers: { authorization: `Bearer ${server.lab.operatorToken}` },
        })
      ).json(),
    ).items;
    const coordinator = server.lab.manifest.roster.find(
      ({ roleSlotId }) => roleSlotId === 'dispatch-coordination',
    )!;
    const specialists = server.lab.manifest.roster.filter(
      ({ roleSlotId }) => roleSlotId !== 'dispatch-coordination',
    );
    const handoffs = interactions.filter(
      ({ kind, recipientRunAgentIds, artifactVersionRefs }) =>
        kind === 'handoff' &&
        recipientRunAgentIds.includes(coordinator.runAgentId) &&
        artifactVersionRefs.length === 1,
    );
    expect(handoffs).toHaveLength(3);
    expect(
      handoffs.every(({ deliveries }) =>
        deliveries.every(({ state }) => state === 'acknowledged'),
      ),
    ).toBe(true);

    const reviewRequest = interactions.find(
      ({ kind, senderId, recipientRunAgentIds }) =>
        kind === 'request' &&
        senderId === coordinator.runAgentId &&
        specialists.every(({ runAgentId }) =>
          recipientRunAgentIds.includes(runAgentId),
        ),
    );
    expect(reviewRequest).toMatchObject({ status: 'responded' });
    const responses = interactions.filter(
      ({ kind, replyToMessageId }) =>
        kind === 'response' && replyToMessageId === reviewRequest?.id,
    );
    expect(responses).toHaveLength(3);
    expect(new Set(responses.map(({ senderId }) => senderId))).toEqual(
      new Set(specialists.map(({ runAgentId }) => runAgentId)),
    );
    expect(
      responses.every(
        ({ artifactVersionRefs }) =>
          artifactVersionRefs.length ===
            reviewRequest?.artifactVersionRefs.length &&
          artifactVersionRefs.every(
            (reference, index) =>
              reference.artifactId ===
                reviewRequest?.artifactVersionRefs[index]?.artifactId &&
              reference.artifactVersionId ===
                reviewRequest?.artifactVersionRefs[index]?.artifactVersionId &&
              reference.contentHash ===
                reviewRequest?.artifactVersionRefs[index]?.contentHash,
          ),
      ),
    ).toBe(true);
  }, 40_000);
});
