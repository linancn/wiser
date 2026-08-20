import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
];
const cookbookRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 1)
      throw new Error('Credential env contains an invalid line.');
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (values[name] !== undefined) {
      throw new Error(`Credential env duplicates ${name}.`);
    }
    values[name] = value;
  }
  const expected = [
    'AGENT_EXCON_PROTOCOL_VERSION',
    'AGENT_EXCON_API_URL',
    'AGENT_EXCON_API_KEY',
    'WISER_RUN_ID',
    'WISER_RUN_AGENT_ID',
    'WISER_ROLE_SLOT_ID',
  ];
  if (
    Object.keys(values).some((name) => !expected.includes(name)) ||
    expected.some((name) => typeof values[name] !== 'string')
  ) {
    throw new Error('Credential env does not match the local lab contract.');
  }
  return values;
}

function assertManifest(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.schemaVersion !== 1 ||
    value.profile !== 'ephemeral-local-tdd' ||
    value.protocolVersion !== 'v2' ||
    value.runState !== 'RUNNING' ||
    !Array.isArray(value.roster) ||
    value.roster.length !== 4 ||
    value.roster.some(
      (entry, index) =>
        entry === null ||
        typeof entry !== 'object' ||
        entry.roleSlotId !== roles[index] ||
        typeof entry.runAgentId !== 'string' ||
        typeof entry.credentialEnvFile !== 'string',
    )
  ) {
    throw new Error('Lab manifest does not match the four-agent v2 contract.');
  }
}

function credentialPath(manifestPath, relativePath) {
  const runtimeDirectory = dirname(manifestPath);
  const credentialsDirectory = resolve(runtimeDirectory, 'credentials');
  const candidate = resolve(runtimeDirectory, relativePath);
  const relation = relative(credentialsDirectory, candidate);
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(
      'Credential path escapes the private credentials directory.',
    );
  }
  return candidate;
}

function rolePrompt({ manifest, role, roleInstructions }) {
  const publicRoster = manifest.roster.map(({ roleSlotId, runAgentId }) => ({
    roleSlotId,
    runAgentId,
  }));
  return `# WISER WorkBuddy participant assignment

Act as exactly one external RunAgent. Load the project-installed \`agent-excon\` Skill before the first MCP call and follow its v2 loop. Use only the \`agent-excon\` MCP server in this process.

Trusted bootstrap:

\`\`\`json
${JSON.stringify(
  {
    protocolVersion: 'v2',
    scenarioVersionId: manifest.scenarioVersionId,
    runId: manifest.runId,
    runAgentId: role.runAgentId,
    roleSlotId: role.roleSlotId,
    teamRoster: publicRoster,
  },
  null,
  2,
)}
\`\`\`

${roleInstructions.trim()}

Hard boundaries:

- Reconcile \`/me\` against the trusted bootstrap before processing content.
- New content arrives only through \`excon_sync\`; recovery GETs never issue eligible content.
- Do not use a browser, operator API, PostgreSQL, repository fixtures, another role's MCP, or v1 fallback.
- Share business content only through WISER Message and immutable ArtifactVersion. Do not use WorkBuddy side channels for case facts.
- Keep credentials and lease tokens out of final output. Return only the structured result required by the launcher.
- Stop on identity mismatch, Receipt-chain conflict, exhausted recovery, or a stable operator-action error.
`;
}

export async function renderWorkBuddyRuntime(options) {
  const labManifestPath = requireAbsolute(
    'labManifestPath',
    options.labManifestPath,
  );
  const nodeExecutable = requireAbsolute(
    'nodeExecutable',
    options.nodeExecutable,
  );
  const outputDirectory = requireAbsolute(
    'outputDirectory',
    options.outputDirectory,
  );
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const workBuddyCli = requireAbsolute('workBuddyCli', options.workBuddyCli);
  const mcpCommand =
    options.mcpCommand === undefined
      ? nodeExecutable
      : requireAbsolute('mcpCommand', options.mcpCommand);
  const mcpArguments =
    options.mcpArguments === undefined
      ? [join(repositoryRoot, 'apps/mcp/dist/index.js')]
      : [...options.mcpArguments];
  if (
    mcpArguments.length === 0 ||
    mcpArguments.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error('mcpArguments must contain at least one string.');
  }
  const manifest = JSON.parse(await readFile(labManifestPath, 'utf8'));
  assertManifest(manifest);

  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('outputDirectory must not already exist.', {
        cause: error,
      });
    }
    throw error;
  }

  try {
    const mcpDirectory = join(outputDirectory, 'mcp');
    const promptsDirectory = join(outputDirectory, 'prompts');
    const resultsDirectory = join(outputDirectory, 'results');
    await Promise.all([
      mkdir(mcpDirectory, { mode: 0o700 }),
      mkdir(promptsDirectory, { mode: 0o700 }),
      mkdir(resultsDirectory, { mode: 0o700 }),
    ]);
    const renderedRoles = [];
    for (const role of manifest.roster) {
      const envPath = credentialPath(labManifestPath, role.credentialEnvFile);
      const env = parseEnv(await readFile(envPath, 'utf8'));
      if (
        env.AGENT_EXCON_PROTOCOL_VERSION !== 'v2' ||
        env.WISER_RUN_ID !== manifest.runId ||
        env.WISER_RUN_AGENT_ID !== role.runAgentId ||
        env.WISER_ROLE_SLOT_ID !== role.roleSlotId
      ) {
        throw new Error(`Credential identity mismatch for ${role.roleSlotId}.`);
      }
      const mcpConfigPath = join(mcpDirectory, `${role.roleSlotId}.json`);
      const mcpConfig = {
        mcpServers: {
          'agent-excon': {
            type: 'stdio',
            command: mcpCommand,
            args: mcpArguments,
            env: {
              AGENT_EXCON_PROTOCOL_VERSION: env.AGENT_EXCON_PROTOCOL_VERSION,
              AGENT_EXCON_API_URL: env.AGENT_EXCON_API_URL,
              AGENT_EXCON_API_KEY: env.AGENT_EXCON_API_KEY,
            },
          },
        },
      };
      await writeFile(
        mcpConfigPath,
        `${JSON.stringify(mcpConfig, null, 2)}\n`,
        {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        },
      );
      const roleInstructions = await readFile(
        join(cookbookRoot, 'roles', `${role.roleSlotId}.md`),
        'utf8',
      );
      const promptPath = join(promptsDirectory, `${role.roleSlotId}.md`);
      await writeFile(
        promptPath,
        rolePrompt({ manifest, role, roleInstructions }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      renderedRoles.push({
        roleSlotId: role.roleSlotId,
        runAgentId: role.runAgentId,
        mcpConfigPath,
        promptPath,
        resultPath: join(resultsDirectory, `${role.roleSlotId}.json`),
        stderrPath: join(resultsDirectory, `${role.roleSlotId}.stderr.log`),
      });
    }
    const publicManifest = {
      schemaVersion: 1,
      profile: 'workbuddy-four-process',
      protocolVersion: 'v2',
      workBuddyCli,
      runId: manifest.runId,
      scenarioVersionId: manifest.scenarioVersionId,
      roles: renderedRoles,
    };
    const launchManifestPath = join(outputDirectory, 'launch-manifest.json');
    await writeFile(
      launchManifestPath,
      `${JSON.stringify(publicManifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    return {
      ...publicManifest,
      outputDirectory,
      launchManifestPath,
    };
  } catch (error) {
    await rm(outputDirectory, { force: true, recursive: true });
    throw error;
  }
}
