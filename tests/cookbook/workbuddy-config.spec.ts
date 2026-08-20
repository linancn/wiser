import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderWorkBuddyRuntime } from '../../cookbooks/workbuddy-yongding-tdd/scripts/render-workbuddy-config.mjs';

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'wiser-workbuddy-config-test-'));
  temporaryDirectories.push(parent);
  const labRuntime = join(parent, 'lab-runtime');
  const credentialsDirectory = join(labRuntime, 'credentials');
  await mkdir(credentialsDirectory, { mode: 0o700, recursive: true });
  const roster = [];
  for (const [index, roleSlotId] of roles.entries()) {
    const runAgentId = `74000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const credentialEnvFile = `credentials/${roleSlotId}.env`;
    await writeFile(
      join(labRuntime, credentialEnvFile),
      [
        'AGENT_EXCON_PROTOCOL_VERSION=v2',
        'AGENT_EXCON_API_URL=http://127.0.0.1:3101/api/v2/',
        `AGENT_EXCON_API_KEY=wbl_${roleSlotId}_test_secret`,
        'WISER_RUN_ID=75000000-0000-4000-8000-000000000001',
        `WISER_RUN_AGENT_ID=${runAgentId}`,
        `WISER_ROLE_SLOT_ID=${roleSlotId}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    roster.push({
      roleSlotId,
      runAgentId,
      agentVersionId: `76000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      instanceKey: `workbuddy-${roleSlotId}`,
      credentialEnvFile,
    });
  }
  await writeFile(
    join(labRuntime, 'manifest.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      profile: 'ephemeral-local-tdd',
      protocolVersion: 'v2',
      scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
      runId: '75000000-0000-4000-8000-000000000001',
      runState: 'RUNNING',
      storageBackend: 'memory',
      restartPolicy: 'abort-run',
      apiBaseUrl: 'http://127.0.0.1:3101/api/v2/',
      roster,
    })}\n`,
    'utf8',
  );
  return {
    labManifestPath: join(labRuntime, 'manifest.json'),
    outputDirectory: join(parent, 'workbuddy-runtime'),
    parent,
  };
}

describe('WorkBuddy role-isolated runtime renderer', () => {
  it('renders four one-token/one-MCP configs and a redacted launch manifest', async () => {
    const input = await fixture();
    const result = await renderWorkBuddyRuntime({
      labManifestPath: input.labManifestPath,
      nodeExecutable: '/opt/homebrew/bin/node',
      outputDirectory: input.outputDirectory,
      repositoryRoot: '/Users/example/wiser',
      workBuddyCli:
        '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
    });

    expect(result.roles.map(({ roleSlotId }) => roleSlotId)).toEqual(roles);
    expect((await stat(input.outputDirectory)).mode & 0o777).toBe(0o700);
    const publicManifest = await readFile(result.launchManifestPath, 'utf8');
    expect(publicManifest).not.toContain('test_secret');
    expect(publicManifest).not.toContain('AGENT_EXCON_API_KEY');

    for (const [index, role] of result.roles.entries()) {
      expect((await stat(role.mcpConfigPath)).mode & 0o777).toBe(0o600);
      const configText = await readFile(role.mcpConfigPath, 'utf8');
      const config = JSON.parse(configText) as {
        readonly mcpServers: Record<
          string,
          {
            readonly command: string;
            readonly args: readonly string[];
            readonly env: Record<string, string>;
          }
        >;
      };
      expect(Object.keys(config.mcpServers)).toEqual(['agent-excon']);
      const server = config.mcpServers['agent-excon']!;
      expect(server.command).toBe('/opt/homebrew/bin/node');
      expect(server.args).toEqual([
        '/Users/example/wiser/apps/mcp/dist/index.js',
      ]);
      expect(server.env).toMatchObject({
        AGENT_EXCON_PROTOCOL_VERSION: 'v2',
        AGENT_EXCON_API_URL: 'http://127.0.0.1:3101/api/v2/',
        AGENT_EXCON_API_KEY: `wbl_${roles[index]!}_test_secret`,
      });
      expect(configText.match(/test_secret/g)).toHaveLength(1);
      for (const otherRole of roles.filter(
        (candidate) => candidate !== role.roleSlotId,
      )) {
        expect(configText).not.toContain(`wbl_${otherRole}_test_secret`);
      }
      const prompt = await readFile(role.promptPath, 'utf8');
      expect(prompt).not.toContain('test_secret');
      expect(prompt).toContain('Do not call `Read`');
      expect(prompt).toContain(
        'Before the first use of every named `excon_*` tool, call `ToolSearch` with that exact tool name',
      );
      expect(prompt).toContain(
        'must not publish a Message or Artifact before `excon_begin_task` succeeds',
      );
      expect(prompt.indexOf('`excon_claim_task`')).toBeLessThan(
        prompt.indexOf('`excon_publish_artifact`'),
      );
      if (role.roleSlotId === 'dispatch-coordination') {
        expect(prompt).toContain('`submissionType=candidate-joint-plan`');
        expect(prompt).toContain('`targetScope=team`');
      } else {
        expect(prompt).toContain('`targetScope=role`');
        expect(prompt).toContain('`endorsementRecipientRunAgentIds=[]`');
      }
    }
  });

  it('refuses relative or existing output targets', async () => {
    const input = await fixture();
    await expect(
      renderWorkBuddyRuntime({
        ...input,
        nodeExecutable: '/opt/homebrew/bin/node',
        outputDirectory: 'relative-runtime',
        repositoryRoot: '/Users/example/wiser',
        workBuddyCli: '/Applications/WorkBuddy.app/Contents/MacOS/Electron',
      }),
    ).rejects.toThrow(/absolute/i);

    await mkdir(input.outputDirectory);
    await expect(
      renderWorkBuddyRuntime({
        ...input,
        nodeExecutable: '/opt/homebrew/bin/node',
        repositoryRoot: '/Users/example/wiser',
        workBuddyCli: '/Applications/WorkBuddy.app/Contents/MacOS/Electron',
      }),
    ).rejects.toThrow(/must not already exist/i);
  });
});
