import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
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
    const chinese = read(
      'apps/docs/src/content/docs/zh-CN/quick-start.md',
    );
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

    expect(webScripts.dev).toBe(
      'next dev --hostname 127.0.0.1 --port 3000',
    );
    expect(docsScripts.dev).toBe(
      'next dev --hostname 127.0.0.1 --port 4321',
    );
  });
});
