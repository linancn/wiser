import { afterEach, describe, expect, it } from 'vitest';

import {
  buildApp,
  createV2LocalLab,
  type LocalLabCredential,
} from '../src/index.js';

interface ReceiptView {
  readonly resourceType: string;
  readonly contentHash: string;
  readonly contentSnapshot: Record<string, unknown>;
}

interface CaseInputContent {
  readonly schemaVersion: number;
  readonly caseId: string;
  readonly scenarioVersionId: string;
  readonly stage: number;
  readonly roleSlotId: string;
  readonly simulationOnly: boolean;
  readonly notForOperationalUse: boolean;
  readonly taskOutputSchema: Record<string, unknown>;
  readonly inputs: Record<string, unknown>;
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function participantHeaders(credential: LocalLabCredential) {
  return {
    authorization: `Bearer ${credential.token}`,
    'x-run-agent-id': credential.runAgentId,
  };
}

describe('published Yongding v2 four-role case', () => {
  it('issues distinct Stage 1 inputs and keeps coordination blocked', async () => {
    const lab = await createV2LocalLab({
      environment: { NODE_ENV: 'test' },
      tokenFactory: (roleSlotId) => `wbl_${roleSlotId}_case_test`,
    });
    const app = buildApp({
      logger: false,
      v2Service: lab.v2Service,
      authenticator: lab.authenticator,
    });
    closeCallbacks.push(() => app.close());

    const contentHashes = new Set<string>();
    for (const [index, credential] of lab.credentials.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v2/runs/${lab.manifest.runId}/sync`,
        headers: {
          ...participantHeaders(credential),
          'idempotency-key': `72000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        },
        payload: { afterReceiptSeq: 0, maxItems: 50 },
      });
      expect(response.statusCode).toBe(200);
      const receipts = response.json<{ receipts: ReceiptView[] }>().receipts;
      const task = receipts.find(({ resourceType }) => resourceType === 'task')
        ?.contentSnapshot as { state?: string } | undefined;
      expect(task?.state).toBe(
        credential.roleSlotId === 'dispatch-coordination' ? 'BLOCKED' : 'READY',
      );

      const caseInputReceipt = receipts.find(
        ({ resourceType, contentSnapshot }) =>
          resourceType === 'artifact' &&
          contentSnapshot['artifactType'] === 'case-input',
      );
      expect(caseInputReceipt).toBeDefined();
      contentHashes.add(caseInputReceipt!.contentHash);
      const caseInput = caseInputReceipt!.contentSnapshot[
        'content'
      ] as CaseInputContent;
      expect(caseInput).toMatchObject({
        schemaVersion: 1,
        caseId: 'jjj-yongding-replenishment-2023',
        scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
        stage: 1,
        roleSlotId: credential.roleSlotId,
        simulationOnly: true,
        notForOperationalUse: true,
      });
      expect(caseInput.taskOutputSchema).toMatchObject({ type: 'object' });

      const serialized = JSON.stringify(caseInput);
      expect(serialized).not.toContain('canonicalPlan');
      expect(serialized).not.toContain('simulatedConstraintUpdate');
      expect(serialized).not.toContain('official-flows-2023-03-23');

      if (credential.roleSlotId === 'water-evidence') {
        expect(caseInput.inputs).toHaveProperty('officialFacts');
        expect(caseInput.inputs).toHaveProperty('sourceAvailability');
        expect(caseInput.inputs).not.toHaveProperty('transferModel');
        expect(caseInput.inputs).not.toHaveProperty('sectionTargets');
      } else if (credential.roleSlotId === 'hydraulic-constraints') {
        expect(caseInput.inputs).toHaveProperty('topology');
        expect(caseInput.inputs).toHaveProperty('transferModel');
        expect(caseInput.inputs).toHaveProperty('totalReleaseLimitM3s');
        expect(caseInput.inputs).not.toHaveProperty('sectionTargets');
        expect(caseInput.inputs).not.toHaveProperty('officialFacts');
      } else if (credential.roleSlotId === 'ecological-target') {
        expect(caseInput.inputs).toHaveProperty('sectionTargets');
        expect(caseInput.inputs).not.toHaveProperty('transferModel');
        expect(caseInput.inputs).not.toHaveProperty('officialFacts');
      } else {
        expect(caseInput.inputs).toMatchObject({
          requiredArtifactKeys: [
            'water-evidence-register',
            'hydraulic-constraint-envelope',
            'ecological-priority-register',
          ],
          requiredEndorsementRoleKeys: [
            'water-evidence',
            'hydraulic-constraints',
            'ecological-target',
          ],
        });
        expect(caseInput.inputs).not.toHaveProperty('rules');
      }
    }
    expect(contentHashes.size).toBe(4);
  });
});
