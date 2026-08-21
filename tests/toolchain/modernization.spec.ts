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

function docpactRule(config: string, id: string): string {
  const marker = `  - id: ${id}\n`;
  const start = config.indexOf(marker);
  if (start === -1) {
    return '';
  }
  const next = config.indexOf('\n  - id: ', start + marker.length);
  return config.slice(start, next === -1 ? undefined : next);
}

function markdownFiles(path: string): string[] {
  const root = resolve(repositoryRoot, path);
  return readdirSync(root).flatMap((entry) => {
    const absolute = resolve(root, entry);
    if (statSync(absolute).isDirectory()) {
      return markdownFiles(`${path}/${entry}`).map(
        (child) => `${entry}/${child}`,
      );
    }
    return /\.mdx?$/.test(entry) ? [entry] : [];
  });
}

describe('TypeScript 7 native toolchain', () => {
  it('serializes process-spawning integration files on constrained CI runners', () => {
    expect(read('vitest.config.ts')).toContain('fileParallelism: false');
  });

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

    expect(existsSync(resolve(repositoryRoot, 'eslint.config.mjs'))).toBe(
      false,
    );
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

    expect(
      existsSync(resolve(repositoryRoot, 'apps/docs/astro.config.mjs')),
    ).toBe(false);
    expect(
      existsSync(resolve(repositoryRoot, 'apps/docs/source.config.ts')),
    ).toBe(true);
    expect(
      existsSync(resolve(repositoryRoot, 'apps/docs/next.config.ts')),
    ).toBe(true);
  });

  it('keeps a complete Chinese-default and English documentation corpus', () => {
    const chinese = markdownFiles('apps/docs/src/content/docs/zh-CN').sort();
    const english = markdownFiles('apps/docs/src/content/docs/en').sort();

    expect(english).toEqual(chinese);
    expect(chinese).toContain('index.mdx');
    expect(chinese).toContain('architecture/wiser-platform.md');
    expect(chinese).toContain('architecture/unified-auth.md');
    expect(chinese).toContain('architecture/design-system.md');
    expect(chinese).toContain('protocols/mcp.md');
    expect(chinese).toContain('scenarios/yongding-river-dispatch.md');
  });

  it('presents one WISER documentation system for every product system', () => {
    const chineseMeta = readJson('apps/docs/src/content/docs/zh-CN/meta.json');
    const englishMeta = readJson('apps/docs/src/content/docs/en/meta.json');

    expect(chineseMeta.title).toBe('WISER');
    expect(englishMeta.title).toBe('WISER');
  });

  it('runs the independent docs service through Next.js', () => {
    const compose = read('compose.yaml');
    expect(compose).toContain(
      'pnpm --filter @agent-excon/docs exec next dev --hostname 0.0.0.0 --port 4321',
    );
    expect(compose).not.toContain('@agent-excon/docs exec astro');
  });

  it('keeps host-generated Fumadocs artifacts out of Docker images', () => {
    const ignored = new Set(
      read('.dockerignore')
        .split('\n')
        .map((line) => line.trim()),
    );

    for (const generated of [
      '**/.next',
      '**/.source',
      '**/node_modules',
      '**/out',
      '**/test-results',
    ]) {
      expect(ignored).toContain(generated);
    }
  });

  it('does not require Git history inside the slim docs container', () => {
    expect(read('apps/docs/source.config.ts')).toContain('lastModified: false');
  });

  it('generates ignored Fumadocs bindings before type-aware lint', () => {
    const rootManifest = readJson('package.json');
    const rootScripts = rootManifest.scripts as Record<string, string>;
    const docsManifest = readJson('apps/docs/package.json');
    const docsScripts = docsManifest.scripts as Record<string, string>;

    expect(rootScripts.prelint).toBe(
      'pnpm --filter @agent-excon/docs generate',
    );
    expect(docsScripts.generate).toBe('fumadocs-mdx');

    const rootIgnore = new Set(
      read('.gitignore')
        .split('\n')
        .map((line) => line.trim()),
    );
    for (const generated of [
      '.source/',
      'out/',
      '*.tsbuildinfo',
      'next-env.d.ts',
    ]) {
      expect(rootIgnore).toContain(generated);
    }
  });
});

describe('Docpact documentation governance', () => {
  it('vendors the pinned Docpact workflow skills for repository-local discovery', () => {
    const source = readJson('.agents/skills/docpact-source.json');
    const commit = 'd07ba8c500c6a10d90edfd7fb062018d2d3cbf96';

    expect(source).toEqual({
      repository: 'Biaoo/docpact',
      version: '0.1.9',
      commit,
      license: 'MIT',
    });
    expect(
      existsSync(resolve(repositoryRoot, '.agents/skills/DOCPACT-LICENSE')),
    ).toBe(true);
    expect(read('.github/workflows/ci.yml')).toContain(
      `Biaoo/docpact@${commit}`,
    );

    for (const skillName of ['docpact', 'docpact-governance']) {
      const skill = read(`.agents/skills/${skillName}/SKILL.md`);
      expect(skill).toContain(`name: ${skillName}`);
      expect(skill).toContain('description:');
    }

    expect(read('.prettierignore')).toContain('.agents/skills/');
    expect(read('.docpact/config.yaml')).not.toContain('.agents/skills');
  });

  it('keeps deterministic local and CI governance entry points', () => {
    expect(existsSync(resolve(repositoryRoot, '.docpact/config.yaml'))).toBe(
      true,
    );

    const rootPackage = readJson('package.json');
    const scripts = rootPackage.scripts as Record<string, string>;
    expect(scripts['docpact:validate']).toBe(
      'docpact validate-config --root . --strict',
    );
    expect(scripts['docpact:check']).toBe(
      'docpact lint --root . --worktree --mode enforce --fail-on-uncovered-change --fail-on-stale-docs',
    );

    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain(
      'Biaoo/docpact@d07ba8c500c6a10d90edfd7fb062018d2d3cbf96',
    );
    expect(workflow).toContain('args: validate-config --root . --strict');
    expect(workflow).toContain('--fail-on-uncovered-change');
    expect(workflow).toContain('--fail-on-stale-docs');

    expect(read('.gitignore')).toContain('.docpact/runs/');
  });

  it('keeps rule triggers narrower than package roots and binds the smallest stable docs', () => {
    const config = read('.docpact/config.yaml');

    for (const [ruleId, narrowPath, broadPath] of [
      [
        'domain-contracts',
        'packages/contracts/src/**',
        'packages/contracts/**',
      ],
      ['http-api', 'apps/api/src/**', 'apps/api/**'],
      ['mcp-adapter', 'apps/mcp/src/**', 'apps/mcp/**'],
      ['evaluation-runtime', 'apps/worker/src/**', 'apps/worker/**'],
      ['product-observatory', 'apps/web/src/**', 'apps/web/**'],
      [
        'telemetry-stack',
        'apps/telemetry-ingress/src/**',
        'apps/telemetry-ingress/**',
      ],
    ]) {
      const rule = docpactRule(config, ruleId);
      expect(rule, ruleId).toContain(`- path: ${narrowPath}`);
      expect(rule, ruleId).not.toContain(`- path: ${broadPath}`);
    }

    const domainRule = docpactRule(config, 'domain-contracts');
    expect(domainRule).toContain('- path: packages/core/src/**');
    expect(domainRule).not.toContain('- path: packages/core/**');

    const databaseRule = docpactRule(config, 'database-schema');
    expect(databaseRule).toContain('- path: supabase/migrations/**');
    expect(databaseRule).toContain('- path: supabase/schemas/**');
    expect(databaseRule).not.toContain('- path: supabase/**');
    expect(docpactRule(config, 'product-observatory')).not.toContain(
      '- path: README.md',
    );
    expect(docpactRule(config, 'evaluation-runtime')).not.toContain(
      '- path: docs/roadmap.md',
    );

    for (const ruleId of ['workbuddy-cookbook-runtime', 'workbuddy-showcase']) {
      expect(docpactRule(config, ruleId), ruleId).not.toBe('');
    }
    expect(docpactRule(config, 'participant-skill')).toBe('');
    expect(docpactRule(config, 'workbuddy-workflows')).toBe('');
    expect(docpactRule(config, 'workbuddy-cookbook-runtime')).not.toContain(
      '- path: cookbooks/workbuddy-yongding-tdd/**',
    );
  });

  it('keeps executable Agent Skills outside documentation governance', () => {
    const config = read('.docpact/config.yaml');

    expect(config).not.toContain('skills/');
    for (const skillPath of [
      'skills/agent-excon/SKILL.md',
      'skills/wiser-workbuddy-showcase/SKILL.md',
      'skills/wiser-yongding-four-agent-tdd/SKILL.md',
    ]) {
      const frontmatter = read(skillPath).split('---')[1];
      expect(frontmatter, skillPath).not.toContain('docType:');
      expect(frontmatter, skillPath).not.toContain('lastReviewedAt:');
      expect(frontmatter, skillPath).not.toContain('checkPaths:');
    }
  });
});
