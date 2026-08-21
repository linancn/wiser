import {
  ApiErrorSchema,
  FeedbackActionGrantSchema,
  RunInteractionListSchema,
  SyncDeliveryBatchSchema,
  type FeedbackActionGrantDto,
  type RunArtifactDto,
  type RunEventDto,
  type RunMessageDto,
  type RunSubmissionDto,
  type RunTaskDto,
  type SubmissionEndorsementDto,
} from '@agent-excon/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_V2_SCENARIO_VERSION_ID,
  InMemoryV2ExerciseService,
  StaticParticipantAuthenticator,
  buildApp,
} from '../src/index.js';

const operatorToken = 'operator-collaboration-token';
const rotatedWaterAgentToken = 'run-agent-water-rotated-token';
const runAgentTokens = [
  'run-agent-water-token',
  'run-agent-hydraulic-token',
  'run-agent-ecology-token',
  'run-agent-dispatch-token',
] as const;
const deterministicRunAgentIds = [
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000017',
  '00000000-0000-4000-8000-000000000020',
] as const;
const roleSlotIds = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

const localized = (value: string) => ({
  'zh-CN': `中文 ${value}`,
  en: `English ${value}`,
});

interface TestResponseBody {
  readonly agent: { readonly id: string };
  readonly agentVersion: { readonly id: string };
  readonly run: { readonly id: string };
  readonly runAgent: { readonly id: string; readonly roleSlotId: string };
  readonly roleAssignment: {
    readonly runAgentId: string;
    readonly roleSlotId: string;
  };
  readonly syncCursor: { readonly afterReceiptSeq: number };
  readonly authoritativeProjection: {
    readonly tasks: readonly RunTaskDto[];
    readonly events: readonly RunEventDto[];
    readonly receipts: readonly unknown[];
    readonly manifest: { readonly atRunSeq: number };
  };
  readonly task: RunTaskDto;
  readonly lease: {
    readonly claimEpoch: number;
    readonly leaseToken: string;
  };
  readonly submission: RunSubmissionDto;
  readonly message: RunMessageDto;
  readonly artifact: RunArtifactDto;
  readonly endorsement: SubmissionEndorsementDto;
  readonly actionGrant: FeedbackActionGrantDto;
  readonly items: readonly unknown[];
}

function json(response: { readonly body: string }): TestResponseBody {
  return JSON.parse(response.body) as TestResponseBody;
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function app() {
  let sequence = 0;
  const instance = buildApp({
    logger: false,
    v2Service: new InMemoryV2ExerciseService({
      idFactory: () => {
        sequence += 1;
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
      },
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    }),
    authenticator: new StaticParticipantAuthenticator({
      [operatorToken]: {
        id: 'operator-collaboration',
        participantVersionIds: [],
        roles: ['operator'],
      },
      ...Object.fromEntries(
        runAgentTokens.map((token, index) => [
          token,
          {
            id: `run-agent-credential-${index + 1}`,
            participantVersionIds: [],
            roles: ['run_agent'] as const,
            runAgentIds: [deterministicRunAgentIds[index]!],
          },
        ]),
      ),
      [rotatedWaterAgentToken]: {
        id: 'run-agent-credential-water-rotated',
        participantVersionIds: [],
        roles: ['run_agent'],
        runAgentIds: [deterministicRunAgentIds[0]],
      },
    }),
  });
  closeCallbacks.push(() => instance.close());
  return instance;
}

function operatorHeaders(key?: number) {
  return {
    authorization: `Bearer ${operatorToken}`,
    ...(key === undefined
      ? {}
      : {
          'idempotency-key': `20000000-0000-4000-8000-${String(key).padStart(12, '0')}`,
        }),
  };
}

function agentHeaders(agentIndex: number, key?: number) {
  return {
    authorization: `Bearer ${runAgentTokens[agentIndex]}`,
    'x-run-agent-id': deterministicRunAgentIds[agentIndex]!,
    ...(key === undefined
      ? {}
      : {
          'idempotency-key': `30000000-0000-4000-8000-${String(key).padStart(12, '0')}`,
        }),
  };
}

async function prepareRunningRun(instance: ReturnType<typeof app>) {
  const agentVersionIds: string[] = [];
  for (const [index, roleSlotId] of roleSlotIds.entries()) {
    const identity = await instance.inject({
      method: 'POST',
      url: '/api/v2/agents',
      headers: operatorHeaders(10 + index),
      payload: {
        displayName: localized(roleSlotId),
        description: localized(`${roleSlotId}-agent`),
      },
    });
    const agentId = json(identity).agent.id;
    const version = await instance.inject({
      method: 'POST',
      url: `/api/v2/agents/${agentId}/versions`,
      headers: operatorHeaders(20 + index),
      payload: {
        expectedAgentVersion: 1,
        providerKind: 'trusted-local-codex',
        model: 'codex-subscription',
        capabilities: [roleSlotId],
        protocolVersion: 'v2',
        telemetryMode: 'partial',
        skillManifestHash: `sha256:${String(index + 1).repeat(64)}`,
        toolManifestHash: `sha256:${String(index + 5).repeat(64)}`,
      },
    });
    agentVersionIds.push(json(version).agentVersion.id);
  }

  const createdRun = await instance.inject({
    method: 'POST',
    url: '/api/v2/runs',
    headers: operatorHeaders(30),
    payload: {
      scenarioVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
      label: localized('可参训协作 Run'),
      mode: 'exercise',
    },
  });
  const runId = json(createdRun).run.id;

  const runAgentIds: string[] = [];
  for (const [index, roleSlotId] of roleSlotIds.entries()) {
    const joined = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/agents`,
      headers: operatorHeaders(40 + index),
      payload: {
        agentVersionId: agentVersionIds[index],
        instanceKey: `${roleSlotId}-instance`,
        roleSlotId,
      },
    });
    runAgentIds.push(json(joined).runAgent.id);
  }
  expect(runAgentIds).toEqual(deterministicRunAgentIds);

  const started = await instance.inject({
    method: 'POST',
    url: `/api/v2/runs/${runId}:start`,
    headers: operatorHeaders(50),
    payload: { expectedVersion: 1 },
  });
  expect(started.statusCode).toBe(200);
  return { runId, runAgentIds };
}

async function sync(
  instance: ReturnType<typeof app>,
  runId: string,
  agentIndex: number,
  key: number,
  afterReceiptSeq = 0,
) {
  const response = await instance.inject({
    method: 'POST',
    url: `/api/v2/runs/${runId}/sync`,
    headers: agentHeaders(agentIndex, key),
    payload: { afterReceiptSeq, maxItems: 100 },
  });
  expect(response.statusCode).toBe(200);
  return SyncDeliveryBatchSchema.parse(json(response));
}

describe('Agent EXCON v2 exercisable collaboration commands', () => {
  it('projects a receipted request-response thread and immutable artifact handoff per recipient', async () => {
    const instance = app();
    const { runId, runAgentIds } = await prepareRunningRun(instance);
    const recipientInitial = await sync(instance, runId, 1, 90);

    const postedRequest = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(0, 91),
      payload: {
        kind: 'request',
        recipientRunAgentIds: [runAgentIds[1]],
        subject: localized('请复核输水约束'),
        body: localized('请依据当前工件回复约束结论。'),
        artifactVersionRefs: [],
      },
    });
    expect(postedRequest.statusCode).toBe(201);
    const requestMessage = json(postedRequest).message;
    expect(requestMessage).toMatchObject({
      kind: 'request',
      threadId: requestMessage.id,
      artifactVersionRefs: [],
    });

    const pendingProjection = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/interactions`,
      headers: operatorHeaders(),
    });
    expect(pendingProjection.statusCode).toBe(200);
    expect(
      RunInteractionListSchema.parse(json(pendingProjection)).items.find(
        ({ id }) => id === requestMessage.id,
      ),
    ).toMatchObject({
      status: 'open',
      deliveries: [
        {
          recipientRunAgentId: runAgentIds[1],
          state: 'pending_sync',
        },
      ],
    });

    const delivered = await sync(
      instance,
      runId,
      1,
      92,
      recipientInitial.throughReceiptSeq,
    );
    const issuedProjection = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/interactions`,
      headers: operatorHeaders(),
    });
    expect(
      RunInteractionListSchema.parse(json(issuedProjection)).items.find(
        ({ id }) => id === requestMessage.id,
      ),
    ).toMatchObject({
      deliveries: [{ state: 'issued' }],
    });

    const unauthorizedReply = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(2, 93),
      payload: {
        kind: 'response',
        replyToMessageId: requestMessage.id,
        recipientRunAgentIds: [runAgentIds[0]],
        subject: localized('越权回复'),
        body: localized('未获得请求收据。'),
        artifactVersionRefs: [],
      },
    });
    expect(unauthorizedReply.statusCode, unauthorizedReply.body).toBe(403);
    expect(ApiErrorSchema.parse(json(unauthorizedReply))).toMatchObject({
      error: { code: 'RESOURCE_NOT_ISSUED' },
    });

    const acknowledged = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/sync`,
      headers: agentHeaders(1, 94),
      payload: {
        afterReceiptSeq: delivered.throughReceiptSeq,
        ack: {
          throughReceiptSeq: delivered.throughReceiptSeq,
          headHash: delivered.receiptHeadHash,
        },
        maxItems: 100,
      },
    });
    expect(acknowledged.statusCode).toBe(200);
    const acknowledgedProjection = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/interactions`,
      headers: operatorHeaders(),
    });
    expect(
      RunInteractionListSchema.parse(json(acknowledgedProjection)).items.find(
        ({ id }) => id === requestMessage.id,
      ),
    ).toMatchObject({
      deliveries: [{ state: 'acknowledged' }],
    });

    const postedResponse = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(1, 95),
      payload: {
        kind: 'response',
        replyToMessageId: requestMessage.id,
        recipientRunAgentIds: [runAgentIds[0]],
        subject: localized('输水约束已复核'),
        body: localized('当前边界可以进入联合方案。'),
        artifactVersionRefs: [],
      },
    });
    expect(postedResponse.statusCode).toBe(201);
    expect(json(postedResponse).message).toMatchObject({
      kind: 'response',
      threadId: requestMessage.threadId,
      replyToMessageId: requestMessage.id,
    });

    const artifactResponse = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/artifacts`,
      headers: agentHeaders(0, 96),
      payload: {
        artifactKey: 'interaction-evidence-register',
        artifactType: 'evidence-register',
        title: localized('协作证据清单'),
        content: { complete: true },
        recipientRunAgentIds: [runAgentIds[0], runAgentIds[3]],
      },
    });
    expect(artifactResponse.statusCode).toBe(201);
    const artifact = json(artifactResponse).artifact;
    const artifactVersionRef = {
      artifactId: artifact.id,
      artifactVersionId: artifact.versionId,
      contentHash: artifact.contentHash,
    };
    const handoff = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(0, 97),
      payload: {
        kind: 'handoff',
        recipientRunAgentIds: [runAgentIds[3]],
        subject: localized('移交协作证据清单'),
        body: localized('请协调角色使用固定版本。'),
        artifactVersionRefs: [artifactVersionRef],
      },
    });
    expect(handoff.statusCode).toBe(201);

    const completedProjection = RunInteractionListSchema.parse(
      json(
        await instance.inject({
          method: 'GET',
          url: `/api/v2/runs/${runId}/interactions`,
          headers: operatorHeaders(),
        }),
      ),
    );
    expect(
      completedProjection.items.find(({ id }) => id === requestMessage.id),
    ).toMatchObject({
      status: 'responded',
      responseMessageIds: [json(postedResponse).message.id],
    });
    expect(
      completedProjection.items.find(
        ({ id }) => id === json(handoff).message.id,
      ),
    ).toMatchObject({
      kind: 'handoff',
      artifactVersionRefs: [artifactVersionRef],
    });
  });

  it('fences a receipted Task lease, creates an immutable submission, and consumes a scoped endorsement grant', async () => {
    const instance = app();
    const { runId, runAgentIds } = await prepareRunningRun(instance);

    const operatorReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=operator`,
      headers: operatorHeaders(),
    });
    const taskId = json(operatorReplay).authoritativeProjection.tasks.find(
      (task) => task.assignedRunAgentId === runAgentIds[0],
    )!.id;
    expect(
      json(operatorReplay).authoritativeProjection.events.some(
        ({ eventType, streamId }) =>
          eventType === 'task.ready' && streamId === taskId,
      ),
    ).toBe(true);

    const teamReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=team&subjectId=joint-dispatch&deliverySemantics=issued`,
      headers: operatorHeaders(),
    });
    expect(json(teamReplay).authoritativeProjection.tasks).toEqual([]);
    expect(json(teamReplay).authoritativeProjection.receipts).toEqual([]);
    expect(
      json(teamReplay).authoritativeProjection.events.some(
        ({ streamType }) => streamType === 'task',
      ),
    ).toBe(false);

    const beforeSync = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:claim`,
      headers: agentHeaders(0, 100),
      payload: { expectedVersion: 1, leaseSeconds: 60 },
    });
    expect(beforeSync.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(json(beforeSync))).toMatchObject({
      error: { code: 'RESOURCE_NOT_ISSUED' },
    });

    const replayBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[0]}&deliverySemantics=issued`,
      headers: agentHeaders(0),
    });
    expect(json(replayBeforeSync).authoritativeProjection.tasks).toEqual([]);
    expect(
      json(replayBeforeSync).authoritativeProjection.events.some(
        ({ streamType }) =>
          streamType === 'task' ||
          streamType === 'message' ||
          streamType === 'artifact',
      ),
    ).toBe(false);

    const firstBatch = await sync(instance, runId, 0, 101);
    const taskReceipt = firstBatch.receipts.find(
      ({ resourceType }) => resourceType === 'task',
    )!;
    expect(taskReceipt.resourceId).toBe(taskId);

    const claimed = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:claim`,
      headers: agentHeaders(0, 102),
      payload: { expectedVersion: 1, leaseSeconds: 60 },
    });
    expect(claimed.statusCode).toBe(200);
    const claim = json(claimed);
    expect(claim).toMatchObject({
      task: { id: taskId, state: 'CLAIMED', lockVersion: 2, claimEpoch: 1 },
      lease: { claimEpoch: 1 },
    });
    expect(claim.lease.leaseToken).toMatch(/^wlt_[A-Za-z0-9_-]{32,}$/);
    expect(claimed.body).not.toContain('leaseTokenHash');

    const replayBeforeTaskStateSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[0]}&deliverySemantics=issued`,
      headers: agentHeaders(0),
    });
    expect(
      json(replayBeforeTaskStateSync).authoritativeProjection.tasks,
    ).toMatchObject([{ id: taskId, state: 'READY', lockVersion: 1 }]);

    const historicalOperatorReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=operator&atRunSeq=${taskReceipt.issuedRunSeq}`,
      headers: operatorHeaders(),
    });
    expect(
      json(historicalOperatorReplay).authoritativeProjection.tasks.find(
        ({ id }) => id === taskId,
      ),
    ).toMatchObject({ id: taskId, state: 'READY', lockVersion: 1 });

    const retriedClaim = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:claim`,
      headers: agentHeaders(0, 102),
      payload: { expectedVersion: 1, leaseSeconds: 60 },
    });
    expect(json(retriedClaim)).toEqual(claim);

    const differentClaim = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:claim`,
      headers: agentHeaders(0, 102),
      payload: { expectedVersion: 2, leaseSeconds: 60 },
    });
    expect(differentClaim.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(differentClaim))).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });

    const thirdTaskId = json(operatorReplay).authoritativeProjection.tasks.find(
      (task) => task.assignedRunAgentId === runAgentIds[2],
    )!.id;
    const thirdInitialBatch = await sync(instance, runId, 2, 113);
    const thirdClaim = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${thirdTaskId}:claim`,
      headers: agentHeaders(2, 114),
      payload: { expectedVersion: 1, leaseSeconds: 60 },
    });
    const thirdLeaseToken = json(thirdClaim).lease.leaseToken;
    const released = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${thirdTaskId}:release`,
      headers: agentHeaders(2, 115),
      payload: {
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: thirdLeaseToken,
      },
    });
    expect(json(released)).toMatchObject({
      task: { state: 'READY', lockVersion: 3, claimEpoch: 1 },
    });
    expect(released.body).not.toContain(thirdLeaseToken);

    const operatorCannotImpersonate = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:begin`,
      headers: {
        ...operatorHeaders(103),
        'x-run-agent-id': runAgentIds[0],
      },
      payload: {
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: claim.lease.leaseToken,
      },
    });
    expect(operatorCannotImpersonate.statusCode).toBe(403);

    const otherAgentCannotOperate = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:begin`,
      headers: agentHeaders(1, 104),
      payload: {
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: claim.lease.leaseToken,
      },
    });
    expect(otherAgentCannotOperate.statusCode).toBe(403);

    const staleLease = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:begin`,
      headers: agentHeaders(0, 105),
      payload: {
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: 'wlt_this-is-not-the-current-opaque-lease-token',
      },
    });
    expect(staleLease.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(staleLease))).toMatchObject({
      error: { code: 'TASK_LEASE_STALE' },
    });

    const begun = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:begin`,
      headers: agentHeaders(0, 106),
      payload: {
        expectedVersion: 2,
        claimEpoch: 1,
        leaseToken: claim.lease.leaseToken,
      },
    });
    expect(json(begun)).toMatchObject({
      task: { state: 'IN_PROGRESS', lockVersion: 3, claimEpoch: 1 },
    });
    expect(begun.body).not.toContain(claim.lease.leaseToken);

    const heartbeat = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}:heartbeat`,
      headers: agentHeaders(0, 107),
      payload: {
        expectedVersion: 3,
        claimEpoch: 1,
        leaseToken: claim.lease.leaseToken,
        extendBySeconds: 60,
      },
    });
    expect(json(heartbeat)).toMatchObject({
      task: { state: 'IN_PROGRESS', lockVersion: 4, claimEpoch: 1 },
    });
    expect(heartbeat.body).not.toContain(claim.lease.leaseToken);

    const replayBeforeSubmission = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=operator`,
      headers: operatorHeaders(),
    });
    const beforeSubmissionRunSeq = json(replayBeforeSubmission)
      .authoritativeProjection.manifest.atRunSeq;

    const submitted = await instance.inject({
      method: 'POST',
      url: `/api/v2/tasks/${taskId}/submissions`,
      headers: agentHeaders(0, 108),
      payload: {
        expectedVersion: 4,
        claimEpoch: 1,
        leaseToken: claim.lease.leaseToken,
        submissionType: 'water-evidence-result',
        targetScope: 'team',
        payload: {
          conclusion: 'The synthetic evidence register is ready.',
          values: [1, true, null, { source: 'receipt' }],
        },
        receiptRefs: [
          {
            receiptId: taskReceipt.id,
            receiptHash: taskReceipt.receiptHash,
          },
        ],
        artifactVersionRefs: [],
        endorsementRecipientRunAgentIds: [runAgentIds[1]],
      },
    });
    expect(submitted.statusCode).toBe(201);
    const submission = json(submitted).submission;
    expect(submission).toMatchObject({
      taskId,
      actorRunAgentId: runAgentIds[0],
      revisionNo: 1,
      targetScope: 'team',
    });
    expect(json(submitted).task).toMatchObject({
      state: 'SUBMITTED',
      lockVersion: 5,
    });
    expect(submitted.body).not.toContain(claim.lease.leaseToken);

    const operatorAfterSubmission = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/events?after=${beforeSubmissionRunSeq}&limit=100`,
      headers: operatorHeaders(),
    });
    expect(
      (json(operatorAfterSubmission).items as readonly RunEventDto[]).filter(
        ({ eventType, streamId }) =>
          eventType === 'submission.created' && streamId === submission.id,
      ),
    ).toHaveLength(1);

    for (const agentIndex of [0, 1, 2]) {
      const beforeSubmissionReceipt = await instance.inject({
        method: 'GET',
        url: `/api/v2/runs/${runId}/submissions`,
        headers: agentHeaders(agentIndex),
      });
      expect(beforeSubmissionReceipt.statusCode).toBe(200);
      expect(json(beforeSubmissionReceipt).items).toEqual([]);
    }

    const recipientReplayBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[1]}&deliverySemantics=issued`,
      headers: agentHeaders(1),
    });
    expect(recipientReplayBeforeSync.body).not.toContain(submission.id);
    expect(recipientReplayBeforeSync.body).not.toContain(
      'The synthetic evidence register is ready.',
    );
    const authorReplayBeforeSubmissionSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[0]}&deliverySemantics=issued`,
      headers: agentHeaders(0),
    });
    expect(
      json(authorReplayBeforeSubmissionSync).authoritativeProjection.events,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          streamType: 'submission',
          streamId: submission.id,
          eventType: 'submission.created',
        }),
      ]),
    );

    const secondBatch = await sync(instance, runId, 1, 109);
    const submissionReceipt = secondBatch.receipts.find(
      ({ resourceType, resourceId }) =>
        resourceType === 'submission' && resourceId === submission.id,
    );
    expect(submissionReceipt).toMatchObject({
      viewKind: 'submission',
      resourceVersion: '1',
      contentSnapshot: submission,
    });

    const recipientSubmissions = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/submissions`,
      headers: agentHeaders(1),
    });
    expect(recipientSubmissions.statusCode).toBe(200);
    expect(json(recipientSubmissions).items).toEqual([submission]);

    const authorStillNeedsOwnSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/submissions`,
      headers: agentHeaders(0),
    });
    expect(json(authorStillNeedsOwnSync).items).toEqual([]);

    const authorSubmissionBatch = await sync(
      instance,
      runId,
      0,
      116,
      firstBatch.throughReceiptSeq,
    );
    expect(
      authorSubmissionBatch.receipts.find(
        ({ resourceType, resourceId }) =>
          resourceType === 'submission' && resourceId === submission.id,
      )?.contentSnapshot,
    ).toEqual(submission);
    const authorSubmissions = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/submissions`,
      headers: agentHeaders(0),
    });
    expect(json(authorSubmissions).items).toEqual([submission]);

    await sync(instance, runId, 2, 117, thirdInitialBatch.throughReceiptSeq);
    const nonRecipientSubmissions = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/submissions`,
      headers: agentHeaders(2),
    });
    expect(json(nonRecipientSubmissions).items).toEqual([]);

    const historicalRecipientReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[1]}&deliverySemantics=issued&atRunSeq=${beforeSubmissionRunSeq}`,
      headers: agentHeaders(1),
    });
    expect(historicalRecipientReplay.body).not.toContain(submission.id);
    expect(historicalRecipientReplay.body).not.toContain(
      'The synthetic evidence register is ready.',
    );

    const grant = secondBatch.receipts
      .filter(({ resourceType }) => resourceType === 'feedback')
      .flatMap(({ contentSnapshot }) => {
        const parsed = FeedbackActionGrantSchema.array().safeParse(
          contentSnapshot.actionGrants,
        );
        return parsed.success ? parsed.data : [];
      })
      .find(
        (candidate) =>
          candidate.action === 'endorse' &&
          candidate.predecessorSubmissionId === submission.id,
      );
    expect(grant).toMatchObject({
      targetRunAgentId: runAgentIds[1],
      targetTaskId: taskId,
      action: 'endorse',
      usedCount: 0,
    });
    if (grant === undefined) {
      throw new Error('expected an issued endorsement ActionGrant');
    }

    const wrongGrantActor = await instance.inject({
      method: 'POST',
      url: `/api/v2/submissions/${submission.id}/endorsements`,
      headers: agentHeaders(0, 110),
      payload: { feedbackActionGrantId: grant.id },
    });
    expect(wrongGrantActor.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(json(wrongGrantActor))).toMatchObject({
      error: { code: 'FEEDBACK_GRANT_SCOPE_MISMATCH' },
    });

    const endorsed = await instance.inject({
      method: 'POST',
      url: `/api/v2/submissions/${submission.id}/endorsements`,
      headers: agentHeaders(1, 111),
      payload: { feedbackActionGrantId: grant.id },
    });
    expect(endorsed.statusCode).toBe(201);
    expect(json(endorsed)).toMatchObject({
      endorsement: {
        submissionId: submission.id,
        endorserRunAgentId: runAgentIds[1],
      },
      actionGrant: { usedCount: 1, version: 2 },
    });

    const retriedEndorsement = await instance.inject({
      method: 'POST',
      url: `/api/v2/submissions/${submission.id}/endorsements`,
      headers: agentHeaders(1, 111),
      payload: { feedbackActionGrantId: grant.id },
    });
    expect(json(retriedEndorsement)).toEqual(json(endorsed));

    const exhausted = await instance.inject({
      method: 'POST',
      url: `/api/v2/submissions/${submission.id}/endorsements`,
      headers: agentHeaders(1, 112),
      payload: { feedbackActionGrantId: grant.id },
    });
    expect(exhausted.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(exhausted))).toMatchObject({
      error: { code: 'FEEDBACK_GRANT_EXHAUSTED' },
    });

    const replay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=operator`,
      headers: operatorHeaders(),
    });
    expect(replay.body).not.toContain(claim.lease.leaseToken);
    expect(
      json(replay).authoritativeProjection.events.map(
        ({ eventType }: { eventType: string }) => eventType,
      ),
    ).toEqual(
      expect.arrayContaining([
        'task.claimed',
        'task.started',
        'task.lease-renewed',
        'task.submitted',
        'feedback-action-grant.consumed',
        'submission.endorsed',
      ]),
    );
  });

  it('freezes message recipients and artifact versions without leaking them to another RunAgent', async () => {
    const instance = app();
    const { runId, runAgentIds } = await prepareRunningRun(instance);
    const firstBatch = await sync(instance, runId, 0, 200);

    const me = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/me`,
      headers: agentHeaders(0),
    });
    expect(me.statusCode).toBe(200);
    expect(json(me)).toMatchObject({
      runAgent: {
        id: runAgentIds[0],
        roleSlotId: roleSlotIds[0],
      },
      roleAssignment: {
        runAgentId: runAgentIds[0],
        roleSlotId: roleSlotIds[0],
      },
      syncCursor: { afterReceiptSeq: firstBatch.throughReceiptSeq },
    });

    const messagePayload = {
      recipientRunAgentIds: [runAgentIds[1]],
      subject: localized('证据已备妥'),
      body: localized('请水动力角色复核。'),
    };
    const postedMessage = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(0, 201),
      payload: messagePayload,
    });
    expect(postedMessage.statusCode).toBe(201);
    expect(json(postedMessage)).toMatchObject({
      message: {
        senderId: runAgentIds[0],
        recipientRunAgentIds: [runAgentIds[1]],
      },
    });

    const replayedAfterCredentialRotation = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: {
        ...agentHeaders(0, 201),
        authorization: `Bearer ${rotatedWaterAgentToken}`,
      },
      payload: messagePayload,
    });
    expect(replayedAfterCredentialRotation.statusCode).toBe(201);
    expect(replayedAfterCredentialRotation.body).toBe(postedMessage.body);

    const authorReplay = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[0]}&deliverySemantics=issued`,
      headers: agentHeaders(0),
    });
    const authorEventTypes = json(
      authorReplay,
    ).authoritativeProjection.events.map(({ eventType }) => eventType);
    expect(authorEventTypes).toContain('message.created');
    expect(
      json(authorReplay).authoritativeProjection.events.filter(
        ({ eventType, streamId }) =>
          eventType === 'message.created' &&
          streamId === json(postedMessage).message.id,
      ),
    ).toHaveLength(1);

    const recipientMessageReplayBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[1]}&deliverySemantics=issued`,
      headers: agentHeaders(1),
    });
    expect(recipientMessageReplayBeforeSync.body).not.toContain(
      json(postedMessage).message.id,
    );

    const changedMessage = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(0, 201),
      payload: { ...messagePayload, recipientRunAgentIds: [runAgentIds[2]] },
    });
    expect(changedMessage.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(changedMessage))).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });

    const secondBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/messages`,
      headers: agentHeaders(1),
    });
    expect(json(secondBeforeSync).items).toEqual([]);

    const secondBatch = await sync(instance, runId, 1, 202);
    expect(
      secondBatch.receipts.some(
        ({ resourceType, resourceId }) =>
          resourceType === 'message' &&
          resourceId === json(postedMessage).message.id,
      ),
    ).toBe(true);
    const thirdBatch = await sync(instance, runId, 2, 203);
    expect(
      thirdBatch.receipts.some(
        ({ resourceType, resourceId }) =>
          resourceType === 'message' &&
          resourceId === json(postedMessage).message.id,
      ),
    ).toBe(false);

    const createdArtifact = await instance.inject({
      method: 'POST',
      url: `/api/v2/runs/${runId}/artifacts`,
      headers: agentHeaders(0, 204),
      payload: {
        artifactKey: 'water-evidence-register',
        artifactType: 'evidence-register',
        title: localized('水情证据清单'),
        content: {
          rows: [{ source: 'synthetic-official-anchor', flow: 12.5 }],
          complete: false,
        },
        recipientRunAgentIds: [runAgentIds[0], runAgentIds[1]],
      },
    });
    expect(createdArtifact.statusCode).toBe(201);
    const firstArtifact = json(createdArtifact).artifact;
    expect(firstArtifact).toMatchObject({
      artifactKey: 'water-evidence-register',
      versionNo: 1,
      authorId: runAgentIds[0],
      recipientRunAgentIds: [runAgentIds[0], runAgentIds[1]],
    });

    const recipientArtifactReplayBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[1]}&deliverySemantics=issued`,
      headers: agentHeaders(1),
    });
    expect(recipientArtifactReplayBeforeSync.body).not.toContain(
      firstArtifact.id,
    );
    const authorArtifactReplayBeforeSync = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/replay?perspective=agent&subjectId=${runAgentIds[0]}&deliverySemantics=issued`,
      headers: agentHeaders(0),
    });
    expect(authorArtifactReplayBeforeSync.body).toContain(firstArtifact.id);

    const artifactBatch = await sync(
      instance,
      runId,
      0,
      205,
      firstBatch.throughReceiptSeq,
    );
    expect(
      artifactBatch.receipts.some(
        ({ resourceType, resourceVersion }) =>
          resourceType === 'artifact' &&
          resourceVersion === firstArtifact.versionId,
      ),
    ).toBe(true);

    const nextArtifactVersion = await instance.inject({
      method: 'POST',
      url: `/api/v2/artifacts/${firstArtifact.id}/versions`,
      headers: agentHeaders(0, 206),
      payload: {
        baseVersionId: firstArtifact.versionId,
        content: {
          rows: [{ source: 'synthetic-official-anchor', flow: 12.5 }],
          complete: true,
        },
        recipientRunAgentIds: [runAgentIds[0], runAgentIds[1]],
      },
    });
    expect(nextArtifactVersion.statusCode).toBe(201);
    expect(json(nextArtifactVersion).artifact).toMatchObject({
      id: firstArtifact.id,
      versionNo: 2,
    });

    const staleBase = await instance.inject({
      method: 'POST',
      url: `/api/v2/artifacts/${firstArtifact.id}/versions`,
      headers: agentHeaders(0, 207),
      payload: {
        baseVersionId: firstArtifact.versionId,
        content: { complete: 'conflicting edit' },
        recipientRunAgentIds: [runAgentIds[0]],
      },
    });
    expect(staleBase.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(staleBase))).toMatchObject({
      error: { code: 'ARTIFACT_BASE_CONFLICT' },
    });

    const unauthorizedVersion = await instance.inject({
      method: 'POST',
      url: `/api/v2/artifacts/${firstArtifact.id}/versions`,
      headers: agentHeaders(2, 208),
      payload: {
        baseVersionId: json(nextArtifactVersion).artifact.versionId,
        content: { stolen: true },
        recipientRunAgentIds: [runAgentIds[2]],
      },
    });
    expect(unauthorizedVersion.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(json(unauthorizedVersion))).toMatchObject({
      error: { code: 'RESOURCE_NOT_ISSUED' },
    });

    const thirdCannotReadSecond = await instance.inject({
      method: 'GET',
      url: `/api/v2/runs/${runId}/messages`,
      headers: {
        authorization: `Bearer ${runAgentTokens[2]}`,
        'x-run-agent-id': runAgentIds[1],
      },
    });
    expect(thirdCannotReadSecond.statusCode).toBe(403);
  });
});
