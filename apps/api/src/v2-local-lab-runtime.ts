import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { ExerciseServiceError } from './types.js';
import type {
  LocalLabManifest,
  LocalLabRoleKey,
  V2LocalLab,
} from './v2-local-lab.js';

export interface WriteV2LocalLabRuntimeBundleOptions {
  readonly apiBaseUrl: string;
  readonly runtimeDirectory: string;
}

export interface LocalLabRuntimeRosterEntry {
  readonly roleSlotId: LocalLabRoleKey;
  readonly runAgentId: string;
  readonly agentVersionId: string;
  readonly instanceKey: string;
  readonly credentialEnvFile: string;
}

export interface LocalLabRuntimeManifest extends Omit<
  LocalLabManifest,
  'roster'
> {
  readonly apiBaseUrl: string;
  readonly roster: readonly LocalLabRuntimeRosterEntry[];
}

export interface LocalLabRuntimeBundle {
  readonly runtimeDirectory: string;
  readonly manifestPath: string;
  readonly credentialFiles: readonly string[];
}

function validationError(message: string): ExerciseServiceError {
  return new ExerciseServiceError('VALIDATION_FAILED', message);
}

function validatedApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw validationError(
      'Lab API URL 必须是合法的 loopback v2 URL。 / The lab API URL must be a valid loopback v2 URL.',
    );
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/api/v2/' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw validationError(
      'Lab API 只能使用 http loopback `/api/v2/`。 / The lab API must use the HTTP loopback `/api/v2/` endpoint.',
    );
  }
  return url.href;
}

function envLine(name: string, value: string): string {
  if (!/^[A-Za-z0-9._:/-]+$/.test(value)) {
    throw validationError(
      `${name} 包含不安全的 env 字符。 / ${name} contains unsafe env characters.`,
    );
  }
  return `${name}=${value}`;
}

export async function writeV2LocalLabRuntimeBundle(
  lab: V2LocalLab,
  options: WriteV2LocalLabRuntimeBundleOptions,
): Promise<LocalLabRuntimeBundle> {
  if (!isAbsolute(options.runtimeDirectory)) {
    throw validationError(
      'Lab runtimeDirectory 必须是绝对路径。 / Lab runtimeDirectory must be absolute.',
    );
  }
  const apiBaseUrl = validatedApiBaseUrl(options.apiBaseUrl);
  const runtimeDirectory = options.runtimeDirectory;
  const credentialsDirectory = join(runtimeDirectory, 'credentials');

  try {
    await mkdir(runtimeDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw validationError(
        'Lab runtimeDirectory 必须尚不存在。 / Lab runtimeDirectory must not already exist.',
      );
    }
    throw error;
  }

  try {
    await mkdir(credentialsDirectory, { mode: 0o700 });
    const credentialFiles: string[] = [];
    const runtimeRoster: LocalLabRuntimeRosterEntry[] = [];
    for (const credential of lab.credentials) {
      const roster = lab.manifest.roster.find(
        ({ roleSlotId }) => roleSlotId === credential.roleSlotId,
      );
      if (roster === undefined || roster.runAgentId !== credential.runAgentId) {
        throw validationError(
          'Lab credential 与公开 roster 不匹配。 / A lab credential does not match the public roster.',
        );
      }
      const credentialEnvFile = `credentials/${credential.roleSlotId}.env`;
      const credentialPath = join(runtimeDirectory, credentialEnvFile);
      const content = [
        envLine('AGENT_EXCON_PROTOCOL_VERSION', 'v2'),
        envLine('AGENT_EXCON_API_URL', apiBaseUrl),
        envLine('AGENT_EXCON_API_KEY', credential.token),
        envLine('WISER_RUN_ID', lab.manifest.runId),
        envLine('WISER_RUN_AGENT_ID', credential.runAgentId),
        envLine('WISER_ROLE_SLOT_ID', credential.roleSlotId),
        '',
      ].join('\n');
      await writeFile(credentialPath, content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      credentialFiles.push(credentialPath);
      runtimeRoster.push({ ...roster, credentialEnvFile });
    }

    const manifest: LocalLabRuntimeManifest = {
      ...lab.manifest,
      apiBaseUrl,
      roster: runtimeRoster,
    };
    const manifestPath = join(runtimeDirectory, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    return {
      runtimeDirectory,
      manifestPath,
      credentialFiles,
    };
  } catch (error) {
    await rm(runtimeDirectory, { force: true, recursive: true });
    throw error;
  }
}
