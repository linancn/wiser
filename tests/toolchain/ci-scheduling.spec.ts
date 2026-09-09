import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);
const required = [
  'docpact',
  'verify',
  'browser',
  'database',
  'data-foundation',
  'observability',
];

function job(id: string): string {
  return workflow.split(`\n  ${id}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';
}

function runGate(results: Record<string, { result: string }>): number | null {
  const gate = job('complete');
  const script = gate.match(
    /node --input-type=module <<'NODE'\n([\s\S]+?)\n\s+NODE/,
  )?.[1];
  expect(script, 'the actual workflow gate must be executable').toBeDefined();
  return spawnSync(process.execPath, ['--input-type=module'], {
    input: script,
    env: { ...process.env, CI_RESULTS: JSON.stringify(results) },
    encoding: 'utf8',
  }).status;
}

describe('CI scheduling and completion', () => {
  it('starts every existing verification lane independently without soft failure', () => {
    for (const id of required) {
      expect(job(id), id).not.toBe('');
      expect(job(id), id).not.toMatch(/\n {4}(?:needs|if):/);
      expect(job(id), id).not.toContain('continue-on-error:');
    }
  });

  it('always evaluates completion after all six required lanes', () => {
    expect(job('complete')).toContain(`needs: [${required.join(', ')}]`);
    expect(job('complete')).toContain('if: always()');
    expect(job('complete')).toContain('CI_RESULTS: ${{ toJSON(needs) }}');
  });

  it('passes only when every required lane succeeds', () => {
    expect(
      runGate(
        Object.fromEntries(required.map((id) => [id, { result: 'success' }])),
      ),
    ).toBe(0);
  });

  it.each(['failure', 'cancelled', 'skipped', 'missing'])(
    'rejects a %s lane even when all others pass',
    (result) => {
      for (const id of required) {
        const results = Object.fromEntries(
          required.map((name) => [name, { result: 'success' }]),
        );
        if (result === 'missing') delete results[id];
        else results[id] = { result };
        expect(runGate(results), id).toBe(1);
      }
    },
  );
});
