import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function read(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('WISER WorkBuddy showcase execution bundle', () => {
  it('routes Codex through a bounded GUI-led showcase without becoming a participant', async () => {
    const [skill, openai, gui, safety, codexTask, leadTask] = await Promise.all(
      [
        read('skills/wiser-workbuddy-showcase/SKILL.md'),
        read('skills/wiser-workbuddy-showcase/agents/openai.yaml'),
        read('skills/wiser-workbuddy-showcase/references/gui-runbook.md'),
        read('skills/wiser-workbuddy-showcase/references/safety-boundaries.md'),
        read(
          'examples/agent-excon/workbuddy-yongding-tdd/showcase/CODEX_SHOWCASE_TASK.md',
        ),
        read(
          'examples/agent-excon/workbuddy-yongding-tdd/showcase/WORKBUDDY_LEAD_SHOWCASE_TASK.md',
        ),
      ],
    );
    const combined = [skill, gui, safety, codexTask, leadTask].join('\n');

    expect(skill).toMatch(/^---\nname: wiser-workbuddy-showcase\n/m);
    expect(skill).not.toContain('[TODO:');
    expect(skill).toContain('references/gui-runbook.md');
    expect(skill).toContain('references/safety-boundaries.md');
    expect(openai).toContain('$wiser-workbuddy-showcase');
    expect(openai).toMatch(/brand_color: ['"]#007A8A['"]/);

    expect(codexTask).toContain('Computer Use');
    expect(codexTask).toContain('/collaboration');
    expect(leadTask).toContain('Lead 不计入四个 RunAgent');
    expect(leadTask).toContain('四个参训进程不调用模型');
    expect(leadTask).toContain('Lead 本身仍可能使用已登录的 WorkBuddy 订阅');
    expect(leadTask).toContain('不得把整个 scripted 展示描述为“无模型调用”');
    expect(combined).toContain('四个独立顶层进程');
    expect(combined).toContain('pnpm showcase:preflight');
    expect(combined).toContain('pnpm showcase:start --profile scripted');
    expect(combined).toContain('pnpm showcase:start --profile rework');
    expect(combined).toContain('pnpm showcase:status');
    expect(combined).toContain('pnpm showcase:stop');
    expect(combined).toContain('WORKBUDDY_LIVE=1');
    expect(combined).toContain('429');
    expect(combined).toContain('TTL');
    expect(combined).toContain('--swarm');
    expect(combined).toContain('bypassPermissions');
    expect(combined).toContain('## English');
    expect(combined).not.toMatch(/防汛|flood/i);
  });

  it('publishes a strict, redacted session contract and three explicit profiles', async () => {
    const [readme, manifestSource, schemaSource] = await Promise.all([
      read('examples/agent-excon/workbuddy-yongding-tdd/showcase/README.md'),
      read(
        'examples/agent-excon/workbuddy-yongding-tdd/showcase/showcase.yaml',
      ),
      read(
        'examples/agent-excon/workbuddy-yongding-tdd/showcase/schemas/showcase-session.schema.json',
      ),
    ]);
    const schema = JSON.parse(schemaSource) as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { enum?: string[]; type?: string | string[] }>;
    };
    const combined = `${readme}\n${manifestSource}`;

    expect(readme).toContain('## English');
    expect(manifestSource).toContain('defaultProfile: scripted');
    expect(manifestSource).toContain('liveRequiresExplicitAuthorization: true');
    expect(manifestSource).toContain('ttlSeconds: 900');
    for (const profile of ['scripted', 'rework', 'workbuddy']) {
      expect(manifestSource).toContain(`- ${profile}`);
    }

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'profile',
        'state',
        'runId',
        'webUrl',
        'expiresAt',
        'reportPath',
        'cleanup',
      ]),
    );
    expect(schema.properties.profile?.enum).toEqual([
      'scripted',
      'rework',
      'workbuddy',
    ]);
    expect(schema.properties).not.toHaveProperty('operatorToken');
    expect(schema.properties).not.toHaveProperty('credentials');
    expect(schema.properties).not.toHaveProperty('mcpConfigPath');
    expect(combined).toContain('0600');
    expect(combined).toContain('十五分钟');
    expect(combined).toContain('scripted');
    expect(combined).toContain('rework');
    expect(combined).toContain('workbuddy');
  });
});
