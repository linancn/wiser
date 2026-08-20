import { describe, expect, it } from 'vitest';

import {
  exerciseRuns,
  getReplayEventsForPerspective,
  getRunById,
  getScenarioById,
  scenarios,
} from './platform';

describe('multi-scenario exercise platform read model', () => {
  it('models a catalog of independently versioned multi-agent scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(3);

    for (const scenario of scenarios) {
      expect(scenario.versions.length).toBeGreaterThan(0);
      expect(scenario.requiredRoles.length).toBeGreaterThanOrEqual(3);
      expect(new Set(scenario.requiredRoles.map((role) => role.id)).size).toBe(
        scenario.requiredRoles.length,
      );
    }
  });

  it('pins every run to a scenario version and staffs every required role', () => {
    for (const run of exerciseRuns) {
      const scenario = getScenarioById(run.scenarioId);
      expect(scenario).toBeDefined();
      expect(
        scenario?.versions.some(
          (version) => version.id === run.scenarioVersionId,
        ),
      ).toBe(true);

      const staffedRoles = new Set(
        run.participants.map((agent) => agent.roleId),
      );
      const distinctAgentInstances = new Set(
        run.participants.map((agent) => agent.id),
      );
      expect(distinctAgentInstances.size).toBe(run.participants.length);
      expect(distinctAgentInstances.size).toBeGreaterThanOrEqual(
        scenario?.requiredRoles.length ?? 0,
      );
      for (const role of scenario?.requiredRoles ?? []) {
        expect(staffedRoles.has(role.id)).toBe(true);
      }
    }
  });

  it('represents cross-agent causality with links instead of a false parent', () => {
    const run = getRunById('run-yongding-spring-042');
    expect(run).toBeDefined();
    expect(run?.participants.length).toBeGreaterThanOrEqual(4);

    const evaluation = run?.spans.find(
      (span) => span.operation === 'evaluation',
    );
    expect(evaluation?.links.length).toBeGreaterThanOrEqual(3);
    expect(
      evaluation?.links.every((link) => link.relation === 'depends_on'),
    ).toBe(true);
  });

  it('replays the receipt captured at the time instead of recomputing visibility', () => {
    const operatorEvents = getReplayEventsForPerspective(
      'run-yongding-spring-042',
      'operator',
    );
    const ecologyAgentEvents = getReplayEventsForPerspective(
      'run-yongding-spring-042',
      'agent-ecology',
    );

    expect(operatorEvents.length).toBeGreaterThan(ecologyAgentEvents.length);
    expect(
      operatorEvents.some((event) => event.visibility === 'operator'),
    ).toBe(true);
    expect(
      ecologyAgentEvents.every((event) =>
        event.visibleTo.includes('agent-ecology'),
      ),
    ).toBe(true);
  });
});
