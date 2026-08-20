import {
  RunEvaluationListSchema,
  type AgentViewReceiptDto,
  type JsonObject,
  type RunArtifactDto,
  type RunFeedbackDto,
  type RunSubmissionDto,
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

interface TaskSubmissionResult {
  readonly submission: RunSubmissionDto;
  readonly task: RunTaskDto;
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
  payload: JsonObject = outputPayloads[credential.roleSlotId],
  expectedState: RunTaskDto['state'] = 'ACCEPTED',
): Promise<{
  readonly result: TaskSubmissionResult;
  readonly artifact: RunArtifactDto;
  readonly caseInputReceipt: AgentViewReceiptDto;
  readonly cursor: SyncBatch;
}> {
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
      content: payload,
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
      payload,
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
  const result = submissionResponse.json<TaskSubmissionResult>();
  expect(result.task.state).toBe(expectedState);
  return {
    result,
    artifact,
    caseInputReceipt,
    cursor: artifactSync,
  };
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

    const specialistResults = new Map<
      string,
      Awaited<ReturnType<typeof completeSpecialistTask>>
    >();
    for (const credential of specialistCredentials.slice(0, 2)) {
      specialistResults.set(
        credential.roleSlotId,
        await completeSpecialistTask(
          app,
          lab,
          credential,
          coordinator,
          initialBatches.get(credential.roleSlotId)!,
        ),
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
    specialistResults.set(
      finalSpecialist.roleSlotId,
      await completeSpecialistTask(
        app,
        lab,
        finalSpecialist,
        coordinator,
        initialBatches.get(finalSpecialist.roleSlotId)!,
      ),
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

    const coordinatorTask = coordinatorSync.receipts
      .filter(({ resourceType }) => resourceType === 'task')
      .map(({ contentSnapshot }) => contentSnapshot as unknown as RunTaskDto)
      .find(({ state }) => state === 'READY')!;
    const coordinatorCaseInput = coordinatorInitial.receipts.find(
      ({ resourceType, contentSnapshot }) =>
        resourceType === 'artifact' &&
        contentSnapshot['artifactType'] === 'case-input',
    )!;
    const specialistArtifacts = coordinatorSync.receipts
      .filter(
        ({ resourceType, contentSnapshot }) =>
          resourceType === 'artifact' &&
          contentSnapshot['artifactType'] === 'role-analysis',
      )
      .map(
        ({ contentSnapshot }) => contentSnapshot as unknown as RunArtifactDto,
      );
    const coordinatorClaimResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${coordinatorTask.id}:claim`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        expectedVersion: coordinatorTask.lockVersion,
        leaseSeconds: 120,
      },
    });
    expect(coordinatorClaimResponse.statusCode).toBe(200);
    const coordinatorClaim = coordinatorClaimResponse.json<ClaimedTask>();
    const coordinatorBeginResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${coordinatorTask.id}:begin`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        expectedVersion: coordinatorClaim.task.lockVersion,
        claimEpoch: coordinatorClaim.lease.claimEpoch,
        leaseToken: coordinatorClaim.lease.leaseToken,
      },
    });
    expect(coordinatorBeginResponse.statusCode).toBe(200);
    const coordinatorBegunTask = coordinatorBeginResponse.json<{
      task: RunTaskDto;
    }>().task;

    const teamPayload = {
      candidatePlan: { stage: 1, simulationOnly: true },
      artifactVersionRefs: specialistArtifacts.map(({ versionId }) =>
        String(versionId),
      ),
      evidenceRefs: [coordinatorCaseInput.id],
    };
    const teamArtifactResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/runs/${lab.manifest.runId}/artifacts`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        artifactKey: 'candidate-joint-plan',
        artifactType: 'team-plan',
        title: { 'zh-CN': 'Stage 1 团队方案', en: 'Stage 1 team plan' },
        content: teamPayload,
        recipientRunAgentIds: lab.credentials.map(
          ({ runAgentId }) => runAgentId,
        ),
      },
    });
    expect(teamArtifactResponse.statusCode).toBe(201);
    const teamArtifact = teamArtifactResponse.json<{
      artifact: RunArtifactDto;
    }>().artifact;
    const teamArtifactSyncResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/runs/${lab.manifest.runId}/sync`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        afterReceiptSeq: coordinatorSync.throughReceiptSeq,
        ack: {
          throughReceiptSeq: coordinatorSync.throughReceiptSeq,
          headHash: coordinatorSync.receiptHeadHash,
        },
        maxItems: 50,
      },
    });
    expect(teamArtifactSyncResponse.statusCode).toBe(200);
    const teamArtifactSync = teamArtifactSyncResponse.json<SyncBatch>();
    expect(
      teamArtifactSync.receipts.some(
        ({ resourceType, resourceVersion }) =>
          resourceType === 'artifact' &&
          resourceVersion === teamArtifact.versionId,
      ),
    ).toBe(true);

    const teamSubmissionResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${coordinatorTask.id}/submissions`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        expectedVersion: coordinatorBegunTask.lockVersion,
        claimEpoch: coordinatorClaim.lease.claimEpoch,
        leaseToken: coordinatorClaim.lease.leaseToken,
        submissionType: 'candidate-joint-plan',
        targetScope: 'team',
        payload: teamPayload,
        receiptRefs: [
          {
            receiptId: coordinatorCaseInput.id,
            receiptHash: coordinatorCaseInput.receiptHash,
          },
        ],
        artifactVersionRefs: [
          ...specialistArtifacts.map((artifact) => ({
            artifactId: artifact.id,
            artifactVersionId: artifact.versionId,
            contentHash: artifact.contentHash,
          })),
          {
            artifactId: teamArtifact.id,
            artifactVersionId: teamArtifact.versionId,
            contentHash: teamArtifact.contentHash,
          },
        ],
        endorsementRecipientRunAgentIds: specialistCredentials.map(
          ({ runAgentId }) => runAgentId,
        ),
      },
    });
    expect(teamSubmissionResponse.statusCode).toBe(201);
    const teamSubmission = teamSubmissionResponse.json<TaskSubmissionResult>();
    expect(teamSubmission.task.state).toBe('SUBMITTED');

    for (const specialist of specialistCredentials) {
      const specialistCursor = specialistResults.get(
        specialist.roleSlotId,
      )!.cursor;
      const reviewSyncResponse = await app.inject({
        method: 'POST',
        url: `/api/v2/runs/${lab.manifest.runId}/sync`,
        headers: {
          ...participantHeaders(specialist),
          'idempotency-key': commandKey(),
        },
        payload: {
          afterReceiptSeq: specialistCursor.throughReceiptSeq,
          ack: {
            throughReceiptSeq: specialistCursor.throughReceiptSeq,
            headHash: specialistCursor.receiptHeadHash,
          },
          maxItems: 50,
        },
      });
      expect(reviewSyncResponse.statusCode).toBe(200);
      const reviewSync = reviewSyncResponse.json<SyncBatch>();
      expect(
        reviewSync.receipts.some(
          ({ resourceType, resourceId }) =>
            resourceType === 'submission' &&
            resourceId === teamSubmission.submission.id,
        ),
      ).toBe(true);
      const reviewFeedback = reviewSync.receipts
        .filter(({ resourceType }) => resourceType === 'feedback')
        .map(
          ({ contentSnapshot }) => contentSnapshot as unknown as RunFeedbackDto,
        )
        .find(
          ({ subjectSubmissionId, allowedActions }) =>
            subjectSubmissionId === teamSubmission.submission.id &&
            allowedActions.includes('endorse'),
        )!;
      const grant = reviewFeedback.actionGrants?.find(
        ({ action }) => action === 'endorse',
      );
      expect(grant).toBeDefined();

      const issuedSubmissions = await app.inject({
        method: 'GET',
        url: `/api/v2/runs/${lab.manifest.runId}/submissions`,
        headers: participantHeaders(specialist),
      });
      expect(
        issuedSubmissions
          .json<{ items: RunSubmissionDto[] }>()
          .items.some(({ id }) => id === teamSubmission.submission.id),
      ).toBe(true);
      const endorsement = await app.inject({
        method: 'POST',
        url: `/api/v2/submissions/${teamSubmission.submission.id}/endorsements`,
        headers: {
          ...participantHeaders(specialist),
          'idempotency-key': commandKey(),
        },
        payload: { feedbackActionGrantId: grant!.id },
      });
      expect(endorsement.statusCode).toBe(201);
    }

    const teamResultSyncResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/runs/${lab.manifest.runId}/sync`,
      headers: {
        ...participantHeaders(coordinator),
        'idempotency-key': commandKey(),
      },
      payload: {
        afterReceiptSeq: teamArtifactSync.throughReceiptSeq,
        ack: {
          throughReceiptSeq: teamArtifactSync.throughReceiptSeq,
          headHash: teamArtifactSync.receiptHeadHash,
        },
        maxItems: 50,
      },
    });
    expect(teamResultSyncResponse.statusCode).toBe(200);
    const teamResultSync = teamResultSyncResponse.json<SyncBatch>();
    expect(
      teamResultSync.receipts.some(
        ({ resourceType, contentSnapshot }) =>
          resourceType === 'task' && contentSnapshot['state'] === 'ACCEPTED',
      ),
    ).toBe(true);
    expect(
      teamResultSync.receipts
        .filter(({ resourceType }) => resourceType === 'feedback')
        .map(
          ({ contentSnapshot }) => contentSnapshot as unknown as RunFeedbackDto,
        )
        .some(({ targetScope }) => targetScope === 'team'),
    ).toBe(true);

    const finalEvents = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/events?after=0&limit=200`,
      headers: { authorization: `Bearer ${lab.operatorToken}` },
    });
    expect(
      finalEvents
        .json<{ items: { eventType: string; payload: unknown }[] }>()
        .items.filter(
          ({ eventType, payload }) =>
            eventType === 'barrier.released' &&
            (payload as { definitionKey?: string }).definitionKey ===
              'endorsement-ready',
        ),
    ).toHaveLength(1);
    const finalEvaluations = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/evaluations`,
      headers: { authorization: `Bearer ${lab.operatorToken}` },
    });
    expect(
      RunEvaluationListSchema.parse(finalEvaluations.json()).items.at(-1),
    ).toMatchObject({
      roleSlotId: 'dispatch-coordination',
      targetScope: 'team',
      verdict: 'ACCEPTED',
    });
  });

  it('issues a scoped resubmit grant and accepts an immutable successor', async () => {
    const lab = await createV2LocalLab({ environment: { NODE_ENV: 'test' } });
    const app = buildApp({
      logger: false,
      v2Service: lab.v2Service,
      authenticator: lab.authenticator,
    });
    closeCallbacks.push(() => app.close());
    const water = lab.credentials.find(
      ({ roleSlotId }) => roleSlotId === 'water-evidence',
    ) as LocalLabCredential & { readonly roleSlotId: 'water-evidence' };
    const coordinator = lab.credentials.find(
      ({ roleSlotId }) => roleSlotId === 'dispatch-coordination',
    )!;
    const initial = await initialSync(app, lab, water);

    const first = await completeSpecialistTask(
      app,
      lab,
      water,
      coordinator,
      initial,
      { evidenceRegister: [] },
      'READY',
    );
    expect(first.result.submission.revisionNo).toBe(1);

    const feedbackSyncResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/runs/${lab.manifest.runId}/sync`,
      headers: {
        ...participantHeaders(water),
        'idempotency-key': commandKey(),
      },
      payload: {
        afterReceiptSeq: first.cursor.throughReceiptSeq,
        ack: {
          throughReceiptSeq: first.cursor.throughReceiptSeq,
          headHash: first.cursor.receiptHeadHash,
        },
        maxItems: 50,
      },
    });
    expect(feedbackSyncResponse.statusCode).toBe(200);
    const feedbackSync = feedbackSyncResponse.json<SyncBatch>();
    const individualFeedback = feedbackSync.receipts
      .filter(({ resourceType }) => resourceType === 'feedback')
      .map(
        ({ contentSnapshot }) => contentSnapshot as unknown as RunFeedbackDto,
      )
      .find(({ targetScope }) => targetScope === 'individual')!;
    expect(individualFeedback.allowedActions).toEqual(['resubmit']);
    const grant = individualFeedback.actionGrants?.find(
      ({ action }) => action === 'resubmit',
    );
    expect(grant).toBeDefined();

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${first.result.task.id}:claim`,
      headers: {
        ...participantHeaders(water),
        'idempotency-key': commandKey(),
      },
      payload: {
        expectedVersion: first.result.task.lockVersion,
        leaseSeconds: 120,
      },
    });
    expect(claimResponse.statusCode).toBe(200);
    const claim = claimResponse.json<ClaimedTask>();
    const beginResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${first.result.task.id}:begin`,
      headers: {
        ...participantHeaders(water),
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

    const revisionResponse = await app.inject({
      method: 'POST',
      url: `/api/v2/tasks/${first.result.task.id}/submissions`,
      headers: {
        ...participantHeaders(water),
        'idempotency-key': commandKey(),
      },
      payload: {
        expectedVersion: begunTask.lockVersion,
        claimEpoch: claim.lease.claimEpoch,
        leaseToken: claim.lease.leaseToken,
        submissionType: outputArtifactKeys['water-evidence'],
        targetScope: 'role',
        payload: outputPayloads['water-evidence'],
        receiptRefs: [
          {
            receiptId: first.caseInputReceipt.id,
            receiptHash: first.caseInputReceipt.receiptHash,
          },
        ],
        artifactVersionRefs: [
          {
            artifactId: first.artifact.id,
            artifactVersionId: first.artifact.versionId,
            contentHash: first.artifact.contentHash,
          },
        ],
        revisionOfId: first.result.submission.id,
        feedbackActionGrantId: grant!.id,
        endorsementRecipientRunAgentIds: [],
      },
    });
    expect(revisionResponse.statusCode).toBe(201);
    expect(revisionResponse.json<TaskSubmissionResult>()).toMatchObject({
      submission: {
        revisionNo: 2,
        revisionOfId: first.result.submission.id,
      },
      task: { state: 'ACCEPTED' },
    });

    const evaluations = await app.inject({
      method: 'GET',
      url: `/api/v2/runs/${lab.manifest.runId}/evaluations`,
      headers: { authorization: `Bearer ${lab.operatorToken}` },
    });
    expect(
      RunEvaluationListSchema.parse(evaluations.json()).items.map(
        ({ verdict }) => verdict,
      ),
    ).toEqual(['REWORK_REQUIRED', 'ACCEPTED']);
  });
});
