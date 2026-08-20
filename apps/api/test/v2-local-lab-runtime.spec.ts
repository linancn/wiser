import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createV2LocalLab,
  writeV2LocalLabRuntimeBundle,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wiser-local-lab-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('v2 local lab runtime bundle', () => {
  it('writes a redacted manifest and four isolated 0600 credential files', async () => {
    const parent = await temporaryDirectory();
    const runtimeDirectory = join(parent, 'runtime');
    const lab = await createV2LocalLab({
      environment: { NODE_ENV: 'test' },
      operatorToken: 'wbl_operator_runtime_test',
      tokenFactory: (roleSlotId) => `wbl_${roleSlotId}_runtime_test`,
    });

    const bundle = await writeV2LocalLabRuntimeBundle(lab, {
      apiBaseUrl: 'http://127.0.0.1:3101/api/v2/',
      runtimeDirectory,
    });

    expect(bundle.manifestPath).toBe(join(runtimeDirectory, 'manifest.json'));
    expect(bundle.credentialFiles).toHaveLength(4);
    expect((await stat(runtimeDirectory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(runtimeDirectory, 'credentials'))).mode & 0o777,
    ).toBe(0o700);

    const manifestText = await readFile(bundle.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText) as {
      readonly apiBaseUrl: string;
      readonly roster: readonly {
        readonly roleSlotId: string;
        readonly credentialEnvFile: string;
      }[];
    };
    expect(manifest.apiBaseUrl).toBe('http://127.0.0.1:3101/api/v2/');
    expect(manifest.roster).toHaveLength(4);
    expect(manifestText).not.toContain(lab.operatorToken);
    for (const { token } of lab.credentials) {
      expect(manifestText).not.toContain(token);
    }

    for (const [index, credentialFile] of bundle.credentialFiles.entries()) {
      expect((await stat(credentialFile)).mode & 0o777).toBe(0o600);
      const content = await readFile(credentialFile, 'utf8');
      const credential = lab.credentials[index]!;
      expect(content).toContain('AGENT_EXCON_PROTOCOL_VERSION=v2');
      expect(content).toContain(
        'AGENT_EXCON_API_URL=http://127.0.0.1:3101/api/v2/',
      );
      expect(content).toContain(`AGENT_EXCON_API_KEY=${credential.token}`);
      expect(content).toContain(`WISER_RUN_ID=${lab.manifest.runId}`);
      expect(content).toContain(`WISER_RUN_AGENT_ID=${credential.runAgentId}`);
      expect(content).toContain(`WISER_ROLE_SLOT_ID=${credential.roleSlotId}`);
      expect(content).not.toContain(lab.operatorToken);
      for (const other of lab.credentials.filter(
        ({ roleSlotId }) => roleSlotId !== credential.roleSlotId,
      )) {
        expect(content).not.toContain(other.token);
      }
    }
  });

  it('rejects non-loopback API URLs and existing runtime targets', async () => {
    const parent = await temporaryDirectory();
    const lab = await createV2LocalLab({ environment: { NODE_ENV: 'test' } });

    await expect(
      writeV2LocalLabRuntimeBundle(lab, {
        apiBaseUrl: 'http://0.0.0.0:3101/api/v2/',
        runtimeDirectory: join(parent, 'remote-runtime'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const existingDirectory = join(parent, 'existing-runtime');
    await writeFile(existingDirectory, 'do-not-overwrite');
    await expect(
      writeV2LocalLabRuntimeBundle(lab, {
        apiBaseUrl: 'http://127.0.0.1:3101/api/v2/',
        runtimeDirectory: existingDirectory,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
