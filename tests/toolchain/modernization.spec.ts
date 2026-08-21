import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

function markdownFiles(path: string): string[] {
  const root = resolve(repositoryRoot, path);
  return readdirSync(root).flatMap((entry) => {
    const absolute = resolve(root, entry);
    if (statSync(absolute).isDirectory()) {
      return markdownFiles(`${path}/${entry}`).map((child) => `${entry}/${child}`);
    }
    return /\.mdx?$/.test(entry) ? [entry] : [];
  });
}

describe('TypeScript 7 native toolchain', () => {
  it('uses Oxlint with the TypeScript 7 native type-aware engine', () => {
    const rootPackage = readJson('package.json');
    const scripts = rootPackage.scripts as Record<string, string>;
    const dependencies = rootPackage.devDependencies as Record<string, string>;

    expect(scripts.lint).toBe('oxlint --type-aware');
    expect(dependencies.typescript).toBe('7.0.2');
    expect(dependencies.oxlint).toBe('1.79.0');
    expect(dependencies['oxlint-tsgolint']).toBe('7.0.2001');

    for (const removed of [
      '@eslint/js',
      'eslint',
      'typescript-eslint',
      'prettier-plugin-astro',
    ]) {
      expect(dependencies).not.toHaveProperty(removed);
    }

    expect(existsSync(resolve(repositoryRoot, 'eslint.config.mjs'))).toBe(false);
    const oxlintConfig = read('.oxlintrc.json');
    expect(oxlintConfig).toContain('"typeAware": true');
    expect(oxlintConfig).toContain('typescript/consistent-type-imports');
    expect(oxlintConfig).toContain('typescript/no-import-type-side-effects');
  });

  it('pins TypeScript 7 across every workspace compiler entry', () => {
    expect(read('pnpm-workspace.yaml')).toContain('typescript: 7.0.2');

    for (const manifestPath of [
      'apps/docs/package.json',
      'apps/web/package.json',
      'apps/worker/package.json',
    ]) {
      const manifest = readJson(manifestPath);
      const dependencies = manifest.devDependencies as Record<string, string>;
      expect(dependencies.typescript, manifestPath).toBe('7.0.2');
    }
  });
});

describe('Fumadocs documentation application', () => {
  it('replaces Astro and Starlight with the pinned Next.js and Fumadocs stack', () => {
    const manifest = readJson('apps/docs/package.json');
    const dependencies = {
      ...(manifest.dependencies as Record<string, string>),
      ...(manifest.devDependencies as Record<string, string>),
    };

    expect(dependencies.next).toBe('16.3.1');
    expect(dependencies['fumadocs-core']).toBe('16.14.5');
    expect(dependencies['fumadocs-ui']).toBe('16.14.5');
    expect(dependencies['fumadocs-mdx']).toBe('15.3.0');
    expect(dependencies).not.toHaveProperty('astro');
    expect(dependencies).not.toHaveProperty('@astrojs/check');
    expect(dependencies).not.toHaveProperty('@astrojs/starlight');

    expect(existsSync(resolve(repositoryRoot, 'apps/docs/astro.config.mjs'))).toBe(
      false,
    );
    expect(existsSync(resolve(repositoryRoot, 'apps/docs/source.config.ts'))).toBe(
      true,
    );
    expect(existsSync(resolve(repositoryRoot, 'apps/docs/next.config.ts'))).toBe(
      true,
    );
  });

  it('keeps a complete Chinese-default and English documentation corpus', () => {
    const chinese = markdownFiles('apps/docs/src/content/docs/zh-CN').sort();
    const english = markdownFiles('apps/docs/src/content/docs/en').sort();

    expect(chinese).toHaveLength(10);
    expect(english).toEqual(chinese);
    expect(chinese).toContain('index.mdx');
    expect(chinese).toContain('protocols/mcp.md');
    expect(chinese).toContain('scenarios/yongding-river-dispatch.md');
  });

  it('runs the independent docs service through Next.js', () => {
    const compose = read('compose.yaml');
    expect(compose).toContain(
      'pnpm --filter @agent-excon/docs exec next dev --hostname 0.0.0.0 --port 4321',
    );
    expect(compose).not.toContain('@agent-excon/docs exec astro');
  });
});
