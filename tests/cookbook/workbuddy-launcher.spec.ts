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

import { launchWorkBuddyRoles } from '../../cookbooks/workbuddy-yongding-tdd/scripts/launch-four-agents.mjs';

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

async function launchFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'wiser-launcher-test-'));
  temporaryDirectories.push(directory);
  const mcpDirectory = join(directory, 'mcp');
  const promptsDirectory = join(directory, 'prompts');
  const resultsDirectory = join(directory, 'results');
  await Promise.all([
    mkdir(mcpDirectory),
    mkdir(promptsDirectory),
    mkdir(resultsDirectory),
  ]);
  const roleEntries = [];
  for (const [index, roleSlotId] of roles.entries()) {
    const mcpConfigPath = join(mcpDirectory, `${roleSlotId}.json`);
    const promptPath = join(promptsDirectory, `${roleSlotId}.md`);
    await writeFile(
      mcpConfigPath,
      `${JSON.stringify({
        mcpServers: {
          'agent-excon': {
            type: 'stdio',
            command: '/opt/homebrew/bin/node',
            args: ['/Users/example/wiser/apps/mcp/dist/index.js'],
            env: {
              AGENT_EXCON_PROTOCOL_VERSION: 'v2',
              AGENT_EXCON_API_URL: 'http://127.0.0.1:3101/api/v2/',
              AGENT_EXCON_API_KEY: `wbl_${roleSlotId}_launcher_secret`,
            },
          },
        },
      })}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      promptPath,
      `Role ${roleSlotId}\nrunId=77000000-0000-4000-8000-000000000001\nrunAgentId=78000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}\n`,
      { mode: 0o600 },
    );
    roleEntries.push({
      roleSlotId,
      runAgentId: `78000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      mcpConfigPath,
      promptPath,
      resultPath: join(resultsDirectory, `${roleSlotId}.json`),
      stderrPath: join(resultsDirectory, `${roleSlotId}.stderr.log`),
    });
  }
  const launchManifestPath = join(directory, 'launch-manifest.json');
  await writeFile(
    launchManifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      profile: 'workbuddy-four-process',
      protocolVersion: 'v2',
      workBuddyCli:
        '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      runId: '77000000-0000-4000-8000-000000000001',
      scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
      roles: roleEntries,
    })}\n`,
    'utf8',
  );
  return { directory, launchManifestPath };
}

describe('four-process WorkBuddy launcher', () => {
  it('runs four fake headless agents and aggregates semantic results', async () => {
    const fixture = await launchFixture();
    const result = await launchWorkBuddyRoles({
      environment: {},
      launchManifestPath: fixture.launchManifestPath,
      mode: 'fake',
      repositoryRoot: '/Users/example/wiser',
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.profile).toBe('scripted-ci');
    expect(result.report.results.map(({ roleSlotId }) => roleSlotId)).toEqual(
      roles,
    );
    expect(
      result.report.results.every(({ status }) => status === 'completed'),
    ).toBe(true);
    const serialized = JSON.stringify(result.report);
    expect(serialized).not.toContain('launcher_secret');
    expect(serialized).not.toContain('AGENT_EXCON_API_KEY');
    for (const command of result.commands) {
      expect(command.args).toContain('--strict-mcp-config');
      expect(command.args).toContain('--no-session-persistence');
      expect(command.args).not.toContain('--json-schema');
      expect(command.args.at(-1)).toContain('"schemaVersion"');
      expect(command.args).not.toContain('--swarm');
      expect(command.args).not.toContain('-y');
      expect(command.args).not.toContain('bypassPermissions');
    }
    expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(result.reportPath, 'utf8'))).toEqual(
      result.report,
    );
  });

  it('requires explicit live opt-in before invoking the installed WorkBuddy', async () => {
    const fixture = await launchFixture();
    await expect(
      launchWorkBuddyRoles({
        environment: {},
        launchManifestPath: fixture.launchManifestPath,
        mode: 'workbuddy',
        repositoryRoot: '/Users/example/wiser',
      }),
    ).rejects.toThrow(/WORKBUDDY_LIVE=1/);
  });
});
