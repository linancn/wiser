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

function docpactRule(config: string, id: string): string {
  const marker = `  - id: ${id}\n`;
  const start = config.indexOf(marker);
  if (start === -1) return '';
  const next = config.indexOf('\n  - id: ', start + marker.length);
  return config.slice(start, next === -1 ? undefined : next);
}

describe('human documentation entrypoints', () => {
  it('makes the root README a current system and runtime directory', () => {
    const chinese = read('README.md');
    const english = read('README.en.md');

    for (const [document, headings] of [
      [
        chinese,
        ['## 系统与入口', '## 应用进程', '## 启动完整平台', '## 开发与验证'],
      ],
      [
        english,
        [
          '## Systems and entrypoints',
          '## Application processes',
          '## Start the complete platform',
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

describe('canonical human documentation governance', () => {
  it('routes current architecture and developer documents without historical authorities', () => {
    const config = read('.docpact/config.yaml');

    for (const removed of [
      'docs/roadmap.md',
      'docs/design/v2-multi-scenario-multi-agent-observability.md',
      'architecture/overview.md',
      'architecture/migration-tdd.md',
    ]) {
      expect(config).not.toContain(removed);
    }

    for (const current of [
      'apps/docs/src/content/docs/*/index.mdx',
      'apps/docs/src/content/docs/*/development/*.md',
      'apps/docs/src/content/docs/*/architecture/agent-excon.md',
      'apps/docs/src/content/docs/*/architecture/wiser-platform.md',
    ]) {
      expect(config, current).toContain(current);
    }

    const domain = docpactRule(config, 'domain-contracts');
    expect(domain).toContain(
      'apps/docs/src/content/docs/zh-CN/architecture/agent-excon.md',
    );
    expect(domain).toContain(
      'apps/docs/src/content/docs/en/architecture/agent-excon.md',
    );

    const evaluation = docpactRule(config, 'evaluation-runtime');
    expect(evaluation).toContain(
      'apps/docs/src/content/docs/zh-CN/development/testing.md',
    );
    expect(evaluation).toContain(
      'apps/docs/src/content/docs/en/development/testing.md',
    );

    const database = docpactRule(config, 'database-schema');
    expect(database).toContain(
      'apps/docs/src/content/docs/zh-CN/development/databases.md',
    );
    expect(database).toContain(
      'apps/docs/src/content/docs/en/development/databases.md',
    );
  });

  it('separates shared hosts from system-specific documentation rules', () => {
    const config = read('.docpact/config.yaml');

    expect(docpactRule(config, 'http-api')).not.toContain(
      '- path: apps/api/src/**',
    );
    expect(docpactRule(config, 'mcp-adapter')).not.toContain(
      '- path: apps/mcp/src/**',
    );
    expect(docpactRule(config, 'product-observatory')).not.toContain(
      '- path: apps/web/src/**',
    );

    const navigation = docpactRule(config, 'documentation-navigation');
    expect(navigation).toContain(
      '- path: apps/docs/src/content/docs/*/meta.json',
    );
    expect(navigation).toContain(
      '- path: apps/docs/src/content/docs/*/*/meta.json',
    );
    expect(navigation).toContain(
      '- path: apps/docs/src/content/docs/zh-CN/development/documentation.md',
    );
    expect(navigation).toContain(
      '- path: apps/docs/src/content/docs/en/development/documentation.md',
    );
  });
});

describe('runnable component guides', () => {
  const applications = [
    'api',
    'data-worker',
    'docs',
    'mcp',
    'telemetry-ingress',
    'web',
    'worker',
  ];

  it('gives every runnable application one scoped human README', () => {
    for (const application of applications) {
      const path = `apps/${application}/README.md`;
      expect(existsSync(resolve(repositoryRoot, path)), path).toBe(true);
      const guide = read(path);
      for (const field of [
        'docType: component-guide',
        'status: active',
        'authoritative: true',
        'owner: wiser',
        'whenToUse:',
        'whenToUpdate:',
        'checkPaths:',
        'lastReviewedAt:',
        'lastReviewedCommit:',
      ]) {
        expect(guide, `${path}: ${field}`).toContain(field);
      }
      expect(guide, path).toMatch(/## (Run|运行|Run \/ 运行)/);
      expect(guide, path).toMatch(/## (Verify|验证|Verify \/ 验证)/);
    }
  });

  it('keeps component guides scoped and removes run-history prose', () => {
    expect(read('apps/api/README.md')).not.toContain('The API pins');
    expect(read('apps/api/README.md')).not.toContain('### Data routes');
    expect(read('apps/mcp/README.md')).not.toContain('## v2 Tools');
    expect(read('apps/mcp/README.md')).not.toContain(
      '## 当前后端边界 / Current backend boundary',
    );
    expect(read('infrastructure/observability/README.md')).not.toContain(
      'independently from the application stack',
    );
    expect(
      read('examples/agent-excon/workbuddy-yongding-tdd/showcase/README.md'),
    ).not.toContain('历史保留的最近一次 live 运行');
  });

  it('inventories and routes every runnable component guide', () => {
    const config = read('.docpact/config.yaml');
    for (const application of applications) {
      expect(config).toContain(`apps/${application}/README.md`);
    }

    expect(docpactRule(config, 'evaluation-runtime')).toContain(
      '- path: apps/worker/README.md',
    );
    expect(docpactRule(config, 'data-foundation-worker')).toContain(
      '- path: apps/data-worker/README.md',
    );
    expect(docpactRule(config, 'telemetry-stack')).toContain(
      '- path: apps/telemetry-ingress/README.md',
    );
  });

  it('preserves the current compatibility, identity, and authority boundaries', () => {
    const root = read('README.md');
    const excon = read(
      'apps/docs/src/content/docs/zh-CN/architecture/agent-excon.md',
    );
    const data = read(
      'apps/docs/src/content/docs/zh-CN/architecture/data-foundation.md',
    );
    const auth = read(
      'apps/docs/src/content/docs/zh-CN/architecture/unified-auth.md',
    );
    const http = read('apps/docs/src/content/docs/zh-CN/protocols/http.md');
    const operator = http.slice(
      http.indexOf('## Operator 管理与观察'),
      http.indexOf('## RunAgent 参训协议'),
    );
    const participant = http.slice(http.indexOf('## RunAgent 参训协议'));

    expect(root).not.toContain('apps/web/src/components/platform');
    expect(excon).toContain('PostgreSQL-backed v1 compatibility/testing');
    expect(excon).toContain('默认 API 的内存 v1 不会向它 enqueue');
    expect(data).toContain('PostGIS spatial readiness');
    expect(data).toContain(
      'Weaviate、OpenSearch、Neo4j 与 STAC 是可重建外部投影',
    );
    expect(data).not.toContain('任何投影都可清空重建');
    expect(auth).toContain('platform_private.delegated_credentials');
    expect(auth).toContain('excon_private.run_agent_credentials');
    expect(auth).toContain('尚未提供此 token 的签发/轮换/撤销 API/CLI');
    expect(operator).toContain('/interactions');
    expect(operator).toContain('/evaluations');
    expect(participant).not.toContain('/interactions');
  });
});
