import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function manifest(path: string): Readonly<Record<string, unknown>> {
  return JSON.parse(read(path)) as Readonly<Record<string, unknown>>;
}

describe('WISER domain asset layout', () => {
  it('packages Agent EXCON runtime scenarios behind a public workspace API', () => {
    const packagePath = 'packages/excon-scenarios';
    const scenarioPath =
      `${packagePath}/scenarios/` + 'jjj-yongding-replenishment-2023';
    const packageManifest = manifest(`${packagePath}/package.json`);
    const apiManifest = manifest('apps/api/package.json');
    const apiDependencies = apiManifest['dependencies'] as Readonly<
      Record<string, unknown>
    >;
    const loader = read('apps/api/src/yongding-v2-case.ts');

    expect(packageManifest).toMatchObject({
      name: '@agent-excon/scenarios',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
    });
    expect(apiDependencies['@agent-excon/scenarios']).toBe('workspace:*');
    expect(loader).toContain("from '@agent-excon/scenarios'");
    expect(loader).not.toContain('readFileSync');
    expect(loader).not.toContain('../../../scenarios/');
    for (const path of [
      'manifest.json',
      'PROVENANCE.md',
      'facts/official-anchors.json',
      'fixture/stage-1.json',
      'fixture/stage-2.json',
      'v2/case-pack.json',
    ]) {
      expect(
        existsSync(resolve(repositoryRoot, scenarioPath, path)),
        path,
      ).toBe(true);
    }
    expect(existsSync(resolve(repositoryRoot, 'scenarios'))).toBe(false);
  });

  it('keeps runnable cookbooks in system-namespaced examples', () => {
    const examplePath = 'examples/agent-excon/workbuddy-yongding-tdd';
    const rootManifest = manifest('package.json');
    const scripts = rootManifest['scripts'] as Readonly<
      Record<string, unknown>
    >;

    expect(
      existsSync(resolve(repositoryRoot, examplePath, 'cookbook.yaml')),
    ).toBe(true);
    expect(
      existsSync(
        resolve(repositoryRoot, examplePath, 'showcase/showcase.yaml'),
      ),
    ).toBe(true);
    expect(existsSync(resolve(repositoryRoot, 'cookbooks'))).toBe(false);
    for (const name of [
      'cookbook:scripted',
      'cookbook:rework',
      'cookbook:workbuddy',
      'codebuddy:install-skill',
      'showcase',
    ]) {
      expect(scripts[name], name).toContain(`${examplePath}/`);
      expect(scripts[name], name).not.toContain('cookbooks/');
    }
  });
});
