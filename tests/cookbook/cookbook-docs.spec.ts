import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function read(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('WorkBuddy Yongding cookbook documentation', () => {
  it('ships a Chinese-default bilingual, executable, and safety-scoped cookbook', async () => {
    const [readme, task, architecture, faults, skill, manifest] =
      await Promise.all([
        read('cookbooks/workbuddy-yongding-tdd/README.md'),
        read('cookbooks/workbuddy-yongding-tdd/WORKBUDDY_TASK.md'),
        read('cookbooks/workbuddy-yongding-tdd/architecture.md'),
        read('cookbooks/workbuddy-yongding-tdd/failure-injection.md'),
        read('.codebuddy/skills/wiser-yongding-four-agent-tdd/SKILL.md'),
        read('cookbooks/workbuddy-yongding-tdd/cookbook.yaml'),
      ]);
    const combined = [readme, task, architecture, faults, skill, manifest].join(
      '\n',
    );

    expect(readme).toMatch(/^# WISER.*WorkBuddy/m);
    expect(readme).toContain('## English');
    expect(readme).toContain('pnpm cookbook:scripted');
    expect(readme).toContain('pnpm cookbook:rework');
    expect(readme).toContain('WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy');
    expect(task).toContain('Lead 不计入四个 RunAgent');
    expect(architecture).toContain('四个独立顶层进程');
    expect(architecture).toContain('WISER Message / Artifact');
    expect(faults).toContain('water-evidence-schema-once');
    expect(faults).toMatch(/REWORK_REQUIRED[\s\S]*revision 2[\s\S]*ACCEPTED/);
    expect(skill).toContain('pnpm cookbook:scripted');
    expect(skill).toContain('不得使用 `--swarm`');
    expect(skill).toContain('不得使用 `-y`');
    expect(manifest).toContain('minDistinctRequiredAgents: 4');
    for (const role of [
      'water-evidence',
      'hydraulic-constraints',
      'ecological-target',
      'dispatch-coordination',
    ]) {
      expect(manifest).toContain(`- ${role}`);
    }
    expect(combined).not.toMatch(/防汛|flood/i);
  });

  it('publishes machine-readable host evals and report contracts', async () => {
    const [evalsSource, reportSchemaSource] = await Promise.all([
      read('.codebuddy/skills/wiser-yongding-four-agent-tdd/evals/evals.json'),
      read(
        'cookbooks/workbuddy-yongding-tdd/schemas/cookbook-report.schema.json',
      ),
    ]);
    const evals = JSON.parse(evalsSource) as { evals: unknown[] };
    const schema = JSON.parse(reportSchemaSource) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(evals.evals).toHaveLength(3);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'status',
        'participantResults',
        'authoritative',
        'tddCycle',
      ]),
    );
    expect(schema.properties).toHaveProperty('authoritative');
  });
});
