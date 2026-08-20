import {
  RunEvaluationListSchema,
  type AgentViewReceiptDto,
  type RunArtifactDto,
  type RunTaskDto,
} from '@agent-excon/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildApp,
  createV2LocalLab,
  type LocalLabCredential,
  type V2LocalLab,
} from '../src/index.js';

interface SyncBatch {
  readonly throughReceiptSeq: number;
  readonly receiptHeadHash: string;
  readonly receipts: readonly AgentViewReceiptDto[];
}

interface ClaimedTask {
  readonly task: RunTaskDto;
  readonly lease: {
    readonly claimEpoch: number;
    readonly leaseToken: string;
  };
}

const closeCallbacks: Array<() => Promise<void>> = [];
let commandSequence = 0;

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  commandSequence = 0;
});

function commandKey(): string {
  commandSequence += 1;
  return `73000000-0000-4000-8000-${String(commandSequence).padStart(12, '0')}`;
}

function participantHeaders(credential: LocalLabCredential) {
  return {
    authorization: `Bearer ${credential.token}`,
    'x-run-agent-id': credential.runAgentId,
  };
}

async function initialSync(
  app: ReturnType<typeof buildApp>,
  lab: V2LocalLab,
  credential: LocalLabCredential,
): Promise<SyncBatch> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v2/runs/${lab.manifest.runId}/sync`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: { afterReceiptSeq: 0, maxItems: 50 },
  });
  expect(response.statusCode).toBe(200);
  return response.json<SyncBatch>();
}

const outputPayloads = {
  'water-evidence': {
    evidenceRegister: [{}, {}, {}],
    inflowSummary: {},
    evidenceRefs: ['stage-1-case-input'],
  },
  'hydraulic-constraints': {
    sectionResponse: [{}, {}, {}, {}],
    constraints: {},
    evidenceRefs: ['stage-1-case-input'],
  },
  'ecological-target': {
    targetRegister: [{}, {}, {}, {}],
    riskPriorities: [{}],
    evidenceRefs: ['stage-1-case-input'],
  },
} as const;

const outputArtifactKeys = {
  'water-evidence': 'water-evidence-register',
  'hydraulic-constraints': 'hydraulic-constraint-envelope',
  'ecological-target': 'ecological-priority-register',
} as const;

async function completeSpecialistTask(
  app: ReturnType<typeof buildApp>,
  lab: V2LocalLab,
  credential: LocalLabCredential & {
    readonly roleSlotId: keyof typeof outputPayloads;
  },
  coordinator: LocalLabCredential,
  initial: SyncBatch,
) {
  const taskReceipt = initial.receipts.find(
    ({ resourceType }) => resourceType === 'task',
  )!;
  const task = taskReceipt.contentSnapshot as unknown as RunTaskDto;
  const caseInputReceipt = initial.receipts.find(
    ({ resourceType, contentSnapshot }) =>
      resourceType === 'artifact' &&
      contentSnapshot['artifactType'] === 'case-input',
  )!;

  const claimResponse = await app.inject({
    method: 'POST',
    url: `/api/v2/tasks/${task.id}:claim`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: { expectedVersion: task.lockVersion, leaseSeconds: 120 },
  });
  expect(claimResponse.statusCode).toBe(200);
  const claim = claimResponse.json<ClaimedTask>();

  const beginResponse = await app.inject({
    method: 'POST',
    url: `/api/v2/tasks/${task.id}:begin`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: {
      expectedVersion: claim.task.lockVersion,
      claimEpoch: claim.lease.claimEpoch,
      leaseToken: claim.lease.leaseToken,
    },
  });
  expect(beginResponse.statusCode).toBe(200);
  const begunTask = beginResponse.json<{ task: RunTaskDto }>().task;

  const artifactResponse = await app.inject({
    method: 'POST',
    url: `/api/v2/runs/${lab.manifest.runId}/artifacts`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: {
      artifactKey: outputArtifactKeys[credential.roleSlotId],
      artifactType: 'role-analysis',
      title: {
        'zh-CN': `${credential.roleSlotId} 输出`,
        en: `${credential.roleSlotId} output`,
      },
      content: outputPayloads[credential.roleSlotId],
      recipientRunAgentIds: [credential.runAgentId, coordinator.runAgentId],
    },
  });
  expect(artifactResponse.statusCode).toBe(201);
  const artifact = artifactResponse.json<{ artifact: RunArtifactDto }>()
    .artifact;

  const artifactSyncResponse = await app.inject({
    method: 'POST',
    url: `/api/v2/runs/${lab.manifest.runId}/sync`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: {
      afterReceiptSeq: initial.throughReceiptSeq,
      ack: {
        throughReceiptSeq: initial.throughReceiptSeq,
        headHash: initial.receiptHeadHash,
      },
      maxItems: 50,
    },
  });
  expect(artifactSyncResponse.statusCode).toBe(200);
  const artifactSync = artifactSyncResponse.json<SyncBatch>();
  expect(
    artifactSync.receipts.some(
      ({ resourceType, resourceId, resourceVersion }) =>
        resourceType === 'artifact' &&
        resourceId === artifact.id &&
        resourceVersion === artifact.versionId,
    ),
  ).toBe(true);

  const submissionResponse = await app.inject({
    method: 'POST',
    url: `/api/v2/tasks/${task.id}/submissions`,
    headers: {
      ...participantHeaders(credential),
      'idempotency-key': commandKey(),
    },
    payload: {
      expectedVersion: begunTask.lockVersion,
      claimEpoch: claim.lease.claimEpoch,
      leaseToken: claim.lease.leaseToken,
      submissionType: outputArtifactKeys[credential.roleSlotId],
      targetScope: 'role',
      payload: outputPayloads[credential.roleSlotId],
      receiptRefs: [
        {
          receiptId: caseInputReceipt.id,
          receiptHash: caseInputReceipt.receiptHash,
        },
      ],
      artifactVersionRefs: [
        {
          artifactId: artifact.id,
          artifactVersionId: artifact.versionId,
          contentHash: artifact.contentHash,
        },
      ],
      endorsementRecipientRunAgentIds: [],
    },
  });
  expect(submissionResponse.statusCode).toBe(201);
  expect(submissionResponse.json<{ task: RunTaskDto }>().task.state).toBe(
    'ACCEPTED',
  );
}

describe('v2 local lab deterministic evaluation and analysis barrier', () => {
  it('accepts three specialist outputs and releases coordination exactly once', async () => {
    const lab = await createV2LocalLab({ environment: { NODE_ENV: 'test' } });
    const app = buildApp({
      logger: false,
      v2Service: lab.v2Service,
      authenticator: lab.authenticator,
    });
    closeCallbacks.push(() => app.close());

    const coordinator = lab.credentials.find(
      ({ roleSlotId }) => roleSlotId === 'dispatch-coordination',
    )!;
    const specialistCredentials = lab.credentials.filter(
      (
        credential,
      ): credential is LocalLabCredential & {
        readonly roleSlotId: keyof typeof outputPayloads;
      } => credential.roleSlotId !== 'dispatch-coordination',
    );
    const initialBatches = new Map<string, SyncBatch>();
    for (const credential of lab.credentials) {
      initialBatches.set(
        credential.roleSlotId,
        await initialSync(app, lab, credential),
      );
    }

    for (const credential of specialistCredentials.slice(0, 2)) {
      await completeSpecialistTask(
        app,
        lab,
        credential,
        coordinator,
        initialBatches.get(credential.roleSlotId)!,
      );
    }
    const coordinatorBeforeRelease = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/tasks`,
      headers: participantHeaders(coordinator),
    });
    expect(
      coordinatorBeforeRelease.json<{ items: RunTaskDto[] }>().items,
    ).toMatchObject([{ state: 'BLOCKED' }]);

    const finalSpecialist = specialistCredentials[2]!;
    await completeSpecialistTask(
      app,
      lab,
      finalSpecialist,
      coordinator,
      initialBatches.get(finalSpecialist.roleSlotId)!,
    );

    const coordinatorInitial = initialBatches.get('dispatch-coordination')!;
    const coordinatorSyncResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/runs/${lab.manifest.runId}/sync`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        afterReceiptSeq: coordinatorInitial.throughReceiptSeq,
        ack: {
          throughReceiptSeq: coordinatorInitial.throughReceiptSeq,
          headHash: coordinatorInitial.receiptHeadHash,
        },
        maxItems: 50,
      },
    });
    expect(coordinatorSyncResponse.statusCode).toBe(200);
    const coordinatorSync = coordinatorSyncResponse.json<SyncBatch>();
    expect(
      coordinatorSync.receipts.some(
        ({ resourceType, contentSnapshot }) =>
          resourceType === 'task' && contentSnapshot['state'] === 'READY',
      ),
    ).toBe(true);
    expect(
      coordinatorSync.receipts.filter(
        ({ resourceType, contentSnapshot }) =>
          resourceType === 'artifact' &&
          contentSnapshot['artifactType'] === 'role-analysis',
      ),
    ).toHaveLength(3);

    const events = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/events?after=0&limit=200`,
      headers: { authorization: `Bearer ${lab.operatorToken}` },
    });
    expect(
      events
        .json<{ items: { eventType: string }[] }>()
        .items.filter(({ eventType }) => eventType === 'barrier.released'),
    ).toHaveLength(1);

    const evaluations = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/evaluations`,
      headers: { authorization: `Bearer ${lab.operatorToken}` },
    });
    expect(evaluations.statusCode).toBe(200);
    expect(
      RunEvaluationListSchema.parse(evaluations.json()).items,
    ).toMatchObject([
      { roleSlotId: 'water-evidence', verdict: 'ACCEPTED' },
      { roleSlotId: 'hydraulic-constraints', verdict: 'ACCEPTED' },
      { roleSlotId: 'ecological-target', verdict: 'ACCEPTED' },
    ]);
  });
});
