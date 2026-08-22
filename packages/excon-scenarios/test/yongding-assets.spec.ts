import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadYongdingV2CasePack,
  YongdingV2CasePackSchema,
} from '../src/index.js';
import {
  loadYongdingStageFixture,
  YongdingStageFixtureSchema,
} from '../src/testing.js';

describe('Agent EXCON scenario assets', () => {
  it('loads the validated runtime case pack independently of cwd', () => {
    const originalCwd = process.cwd();
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'wiser-excon-scenario-'),
    );
    try {
      process.chdir(temporaryDirectory);
      const casePack = loadYongdingV2CasePack();
      expect(casePack).toMatchObject({
        caseId: 'jjj-yongding-replenishment-2023',
        protocolVersion: 'v2',
        scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
        simulationOnly: true,
        notForOperationalUse: true,
      });
      expect(Object.keys(casePack.roles).sort()).toEqual([
        'dispatch-coordination',
        'ecological-target',
        'hydraulic-constraints',
        'water-evidence',
      ]);
    } finally {
      process.chdir(originalCwd);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each([1, 2] as const)(
    'loads stage %i only through the fixed testing allowlist',
    (stage) => {
      const fixture = loadYongdingStageFixture(stage);
      expect(fixture).toMatchObject({
        stage,
        simulationOnly: true,
        notForOperationalUse: true,
        canonicalPlan: { stage },
      });
      expect(fixture.canonicalPlan.isFinal).toBe(stage === 2);
    },
  );

  it('rejects invalid safety fields and non-allowlisted stages', () => {
    const fixture = loadYongdingStageFixture(1);
    expect(() =>
      YongdingStageFixtureSchema.parse({
        ...fixture,
        simulationOnly: false,
      }),
    ).toThrow();
    expect(() => loadYongdingStageFixture(3 as 1 | 2)).toThrow();
    expect(() =>
      YongdingV2CasePackSchema.parse({
        ...loadYongdingV2CasePack(),
        notForOperationalUse: false,
      }),
    ).toThrow();
  });

  it('does not expose canonical fixtures from the runtime entrypoint', async () => {
    const runtimeApi: Readonly<Record<string, unknown>> =
      await import('../src/index.js');
    expect(runtimeApi).not.toHaveProperty('loadYongdingStageFixture');
    expect(runtimeApi).not.toHaveProperty('YongdingStageFixtureSchema');
  });
});
