import { afterEach, describe, expect, it } from 'vitest';

import {
  buildApp,
  createV2LocalLab,
  type LocalLabCredential,
} from '../src/index.js';

const expectedRoles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function deterministicIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  };
}

function participantHeaders(credential: LocalLabCredential) {
  return {
    authorization: `Bearer ${credential.token}`,
    'x-run-agent-id': credential.runAgentId,
  };
}

describe('v2 local four-agent lab bootstrap', () => {
  it('creates four distinct credential-bound RunAgents and starts one Run', async () => {
    const lab = await createV2LocalLab({
      environment: { NODE_ENV: 'test' },
      idFactory: deterministicIdFactory(),
      now: () => new Date('2026-08-20T14:00:00.000Z'),
      operatorToken: 'wbl_operator_local_only',
      tokenFactory: (roleSlotId) => `wbl_${roleSlotId}_local_only`,
    });
    const app = buildApp({
      logger: false,
      v2Service: lab.v2Service,
      authenticator: lab.authenticator,
    });
    closeCallbacks.push(() => app.close());

    expect(lab.manifest).toMatchObject({
      schemaVersion: 1,
      profile: 'ephemeral-local-tdd',
      protocolVersion: 'v2',
      scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
      runState: 'RUNNING',
    });
    expect(lab.manifest.roster.map(({ roleSlotId }) => roleSlotId)).toEqual(
      expectedRoles,
    );
    expect(
      new Set(lab.manifest.roster.map(({ runAgentId }) => runAgentId)),
    ).toHaveSize(4);
    expect(new Set(lab.credentials.map(({ token }) => token))).toHaveSize(4);
    expect(JSON.stringify(lab.manifest)).not.toContain('wbl_');

    for (const [index, credential] of lab.credentials.entries()) {
      const assignment = await app.inject({
        method: 'GET',
        url: `/api/v2/runs/${lab.manifest.runId}/me`,
        headers: participantHeaders(credential),
      });
      expect(assignment.statusCode).toBe(200);
      expect(assignment.json()).toMatchObject({
        runAgent: {
          id: credential.runAgentId,
          runId: lab.manifest.runId,
          roleSlotId: expectedRoles[index],
        },
        roleAssignment: {
          runAgentId: credential.runAgentId,
          roleSlotId: expectedRoles[index],
        },
      });

      const batch = await app.inject({
        method: 'POST',
        url: `/api/v2/runs/${lab.manifest.runId}/sync`,
        headers: {
          ...participantHeaders(credential),
          'idempotency-key': `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        },
        payload: { afterReceiptSeq: 0, maxItems: 50 },
      });
      expect(batch.statusCode).toBe(200);
      expect(batch.json()).toMatchObject({
        runId: lab.manifest.runId,
        runAgentId: credential.runAgentId,
      });
      expect(batch.body).not.toContain(credential.token);
    }

    const crossedIdentity = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/me`,
      headers: {
        authorization: `Bearer ${lab.credentials[0]!.token}`,
        'x-run-agent-id': lab.credentials[1]!.runAgentId,
      },
    });
    expect(crossedIdentity.statusCode).toBe(403);

    const operatorImpersonation = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/me`,
      headers: {
        authorization: `Bearer ${lab.operatorToken}`,
        'x-run-agent-id': lab.credentials[0]!.runAgentId,
      },
    });
    expect(operatorImpersonation.statusCode).toBe(403);
  });

  it('refuses to create the ephemeral lab in production', async () => {
    await expect(
      createV2LocalLab({ environment: { NODE_ENV: 'production' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
