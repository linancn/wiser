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
    const child = `${path}/${entry}`;
    const absolute = resolve(repositoryRoot, child);
    return statSync(absolute).isDirectory()
      ? markdownFiles(child)
      : /\.mdx?$/.test(entry)
        ? [child]
        : [];
  });
}

describe('human documentation entrypoints', () => {
  it('makes the root README a current system and runtime directory', () => {
    const chinese = read('README.md');
    const english = read('README.en.md');

    for (const [document, headings] of [
      [
        chinese,
        ['## 系统与入口', '## 应用进程', '## 五分钟启动', '## 开发与验证'],
      ],
      [
        english,
        [
          '## Systems and entrypoints',
          '## Application processes',
          '## Start in five minutes',
          '## Develop and verify',
        ],
      ],
    ] as const) {
      for (const heading of headings) expect(document).toContain(heading);

      for (const required of [
        'apps/web',
        'apps/api',
        'apps/worker',
        'apps/data-worker',
        'apps/mcp',
        'apps/docs',
        '/api/platform/v1',
        '/api/v2',
        '/api/data/v1',
        '/graphql',
        'pnpm stack:full:up',
        'pnpm stack:down',
      ]) {
        expect(document, required).toContain(required);
      }
    }

    for (const historicalNarrative of [
      '## 当前已交付',
      '本轮关键应用 pin',
      'WISER has evolved from',
      '## Delivered now',
      'Key application pins in this delivery',
    ]) {
      expect(`${chinese}\n${english}`).not.toContain(historicalNarrative);
    }
  });

  it('keeps quick start focused on an executable first run', () => {
    const chinese = read('apps/docs/src/content/docs/zh-CN/quick-start.md');
    const english = read('apps/docs/src/content/docs/en/quick-start.md');

    for (const heading of [
      '## 1. 安装',
      '## 2. 启动完整平台',
      '## 3. 打开入口',
      '## 4. 停止',
    ]) {
      expect(chinese).toContain(heading);
    }
    for (const heading of [
      '## 1. Install',
      '## 2. Start the complete platform',
      '## 3. Open the entrypoints',
      '## 4. Stop',
    ]) {
      expect(english).toContain(heading);
    }

    expect(chinese).toContain('/development/local-environment/');
    expect(english).toContain('/en/development/local-environment/');
    expect(`${chinese}\n${english}`).not.toMatch(
      /本轮|this delivery|Delivered now|已交付边界/,
    );
  });

  it('routes documentation readers by task instead of delivery history', () => {
    const chinese = read('apps/docs/src/content/docs/zh-CN/index.mdx');
    const english = read('apps/docs/src/content/docs/en/index.mdx');

    expect(chinese).toContain('## 按任务查文档');
    expect(english).toContain('## Find documentation by task');
    expect(chinese).toContain('/development/');
    expect(english).toContain('/en/development/');
    expect(`${chinese}\n${english}`).not.toContain('<HomeTimeline');
  });

  it('gives each application a deterministic local development port', () => {
    const web = readJson('apps/web/package.json');
    const docs = readJson('apps/docs/package.json');
    const webScripts = web.scripts as Record<string, string>;
    const docsScripts = docs.scripts as Record<string, string>;

    expect(webScripts.dev).toBe('next dev --hostname 127.0.0.1 --port 3000');
    expect(docsScripts.dev).toBe('next dev --hostname 127.0.0.1 --port 4321');
  });
});

describe('developer handbook and current-state architecture', () => {
  const developmentPages = [
    'index.md',
    'repository-structure.md',
    'local-environment.md',
    'backend.md',
    'frontend.md',
    'databases.md',
    'testing.md',
    'documentation.md',
    'adding-a-system.md',
  ];

  it('provides the same complete developer handbook in both languages', () => {
    for (const locale of ['zh-CN', 'en']) {
      const root = `apps/docs/src/content/docs/${locale}/development`;
      for (const page of developmentPages) {
        expect(existsSync(resolve(repositoryRoot, root, page)), page).toBe(
          true,
        );
      }

      const meta = readJson(`${root}/meta.json`);
      expect(meta.pages).toEqual(
        developmentPages.map((page) => page.replace(/\.md$/, '')),
      );
    }
  });

  it('replaces milestone and migration narratives with current architecture', () => {
    for (const removed of [
      'docs/roadmap.md',
      'docs/design/v2-multi-scenario-multi-agent-observability.md',
      'apps/docs/src/content/docs/zh-CN/architecture/migration-tdd.md',
      'apps/docs/src/content/docs/en/architecture/migration-tdd.md',
      'apps/docs/src/content/docs/zh-CN/contributing/tdd.md',
      'apps/docs/src/content/docs/en/contributing/tdd.md',
    ]) {
      expect(existsSync(resolve(repositoryRoot, removed)), removed).toBe(false);
    }

    for (const locale of ['zh-CN', 'en']) {
      const architecture = `apps/docs/src/content/docs/${locale}/architecture`;
      expect(
        existsSync(resolve(repositoryRoot, architecture, 'agent-excon.md')),
      ).toBe(true);
      expect(
        existsSync(resolve(repositoryRoot, architecture, 'overview.md')),
      ).toBe(false);

      const excon = read(`${architecture}/agent-excon.md`);
      for (const invariant of [
        'RunAgent',
        'Barrier',
        'AgentViewReceipt',
        'Idempotency-Key',
        'OpenTelemetry',
      ]) {
        expect(excon, `${locale}: ${invariant}`).toContain(invariant);
      }
    }
  });

  it('removes superseded delivery language from human-facing documentation', () => {
    const corpus = [
      'README.md',
      'README.en.md',
      ...markdownFiles('apps/docs/src/content/docs'),
    ]
      .map(read)
      .join('\n');

    for (const historicalNarrative of [
      '当前已交付',
      '本轮实际',
      '本轮关键',
      'this delivery',
      'Delivered now',
      'delivered state',
    ]) {
      expect(corpus).not.toContain(historicalNarrative);
    }
  });
});
