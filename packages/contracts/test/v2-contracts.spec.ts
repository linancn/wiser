import { describe, expect, it } from 'vitest';

import {
  AgentIdentitySchema,
  AgentViewReceiptSchema,
  AgentVersionSchema,
  ApiErrorCodeSchema,
  BestEffortTelemetryOverlaySchema,
  CreateArtifactVersionRequestSchema,
  CreateRunArtifactRequestSchema,
  CreateRunMessageRequestSchema,
  CreateTaskSubmissionRequestSchema,
  FeedbackActionGrantSchema,
  ManageScenarioSummarySchema,
  PublicScenarioSummarySchema,
  RunAgentSchema,
  RunAuthoritativeProjectionSchema,
  RunEvaluationListSchema,
  RunResourceSchema,
  RunSchema,
  RunSubmissionSchema,
  RunSyncRequestSchema,
  RunTaskSchema,
  RunInteractionListSchema,
  RunMessageSchema,
  SyncDeliveryBatchSchema,
  TaskClaimRequestSchema,
  TaskHeartbeatRequestSchema,
  TaskLeaseCommandRequestSchema,
} from '../src/index.js';

const text = { 'zh-CN': '永定河联合调度', en: 'Yongding joint dispatch' };

describe('Agent EXCON v2 contracts', () => {
  it('keeps the public scenario DTO structurally unable to expose draft management data', () => {
    const publicScenario = {
      id: 'jing-jin-ji-yongding-river',
      slug: 'jing-jin-ji-yongding-river',
      title: text,
      description: text,
      region: { 'zh-CN': '京津冀', en: 'Jing-Jin-Ji' },
      simulationOnly: true,
      lifecycle: 'PUBLISHED',
      currentVersionId: 'jjj-yongding-collaboration-2023-v2',
      publishedVersionCount: 1,
      requiredRoleCount: 4,
      minDistinctRequiredAgents: 4,
    };

    expect(PublicScenarioSummarySchema.parse(publicScenario)).toEqual(
      publicScenario,
    );
    expect(
      PublicScenarioSummarySchema.safeParse({
        ...publicScenario,
        draftVersionCount: 2,
      }).success,
    ).toBe(false);

    expect(
      ManageScenarioSummarySchema.safeParse({
        ...publicScenario,
        ownerId: 'operator-a',
        version: 1,
        draftVersionCount: 1,
        latestValidationStatus: 'VALID',
        updatedAt: '2026-08-20T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('validates versioned agent, run-agent and independently versioned task DTOs', () => {
    const agent = AgentIdentitySchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      ownerId: 'operator-a',
      displayName: text,
      description: text,
      lifecycle: 'ACTIVE',
      version: 1,
      createdAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T08:00:00.000Z',
    });
    const agentVersion = AgentVersionSchema.parse({
      id: '00000000-0000-4000-8000-000000000002',
      agentId: agent.id,
      lifecycle: 'PUBLISHED',
      providerKind: 'trusted-local-codex',
      model: 'codex-subscription',
      capabilities: ['water-evidence'],
      protocolVersion: 'v2',
      telemetryMode: 'partial',
      skillManifestHash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      toolManifestHash:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      contentHash:
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      version: 1,
      publishedAt: '2026-08-20T08:00:00.000Z',
    });
    const run = RunSchema.parse({
      id: '00000000-0000-4000-8000-000000000003',
      scenarioVersionId: 'jjj-yongding-collaboration-2023-v2',
      ownerId: 'operator-a',
      label: text,
      mode: 'exercise',
      state: 'FORMING',
      virtualTime: '2023-03-22T07:00:00.000Z',
      version: 1,
      createdAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T08:00:00.000Z',
    });
    const runAgent = RunAgentSchema.parse({
      id: '00000000-0000-4000-8000-000000000004',
      runId: run.id,
      agentVersionId: agentVersion.id,
      instanceKey: 'water-evidence-a',
      roleSlotId: 'water-evidence',
      state: 'JOINED',
      version: 1,
      joinedAt: '2026-08-20T08:00:00.000Z',
    });
    const task = RunTaskSchema.parse({
      id: '00000000-0000-4000-8000-000000000005',
      runId: run.id,
      roleSlotId: runAgent.roleSlotId,
      assignedRunAgentId: runAgent.id,
      definitionKey: 'analyze-water-evidence',
      title: text,
      objective: text,
      state: 'READY',
      lockVersion: 1,
      createdRunSeq: 4,
    });

    expect(task.lockVersion).toBe(1);
    expect(run.version).toBe(1);
  });

  it('makes sync cursors, immutable receipts, authoritative replay and telemetry trust explicit', () => {
    expect(
      RunSyncRequestSchema.safeParse({
        afterReceiptSeq: 0,
        maxItems: 50,
        unexpected: true,
      }).success,
    ).toBe(false);
    const request = RunSyncRequestSchema.parse({ afterReceiptSeq: 0 });
    expect(request.maxItems).toBe(50);

    const delivery = SyncDeliveryBatchSchema.parse({
      deliveryBatchId: '00000000-0000-4000-8000-000000000010',
      runId: '00000000-0000-4000-8000-000000000003',
      runAgentId: '00000000-0000-4000-8000-000000000004',
      fromReceiptSeq: 1,
      throughReceiptSeq: 1,
      receiptHeadHash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      runCursor: 7,
      hasMore: false,
      receipts: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          runId: '00000000-0000-4000-8000-000000000003',
          runAgentId: '00000000-0000-4000-8000-000000000004',
          agentReceiptSeq: 1,
          deliveryBatchId: '00000000-0000-4000-8000-000000000010',
          sourceEventId: '00000000-0000-4000-8000-000000000012',
          sourceRunSeq: 4,
          issuedEventId: '00000000-0000-4000-8000-000000000013',
          issuedRunSeq: 7,
          viewKind: 'task_assignment',
          resourceType: 'task',
          resourceId: '00000000-0000-4000-8000-000000000005',
          resourceVersion: '1',
          availableVirtualAt: '2023-03-22T07:00:00.000Z',
          issuedVirtualAt: '2023-03-22T07:00:00.000Z',
          issuedAt: '2026-08-20T08:00:00.000Z',
          schemaVersion: 1,
          contentSnapshot: { state: 'READY' },
          contentHash:
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          previousReceiptHash:
            'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          receiptHash:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    });
    expect(delivery.receipts).toHaveLength(1);
    expect(
      SyncDeliveryBatchSchema.safeParse({
        ...delivery,
        fromReceiptSeq: 2,
        throughReceiptSeq: 1,
      }).success,
    ).toBe(false);
    expect(
      SyncDeliveryBatchSchema.safeParse({
        ...delivery,
        receipts: [],
        fromReceiptSeq: 2,
      }).success,
    ).toBe(false);

    expect(
      RunAuthoritativeProjectionSchema.safeParse({ bestEffort: true }).success,
    ).toBe(false);
    expect(
      BestEffortTelemetryOverlaySchema.parse({
        bestEffort: true,
        gap: true,
        traces: [],
        coverage: {
          boundaryCoverage: 1,
          participantTelemetryMode: 'none',
          droppedSpanCount: 0,
          lateSpanCount: 0,
        },
        trust: {
          platformObservedSpanCount: 0,
          participantReportedSpanCount: 0,
        },
      }).gap,
    ).toBe(true);
  });

  it('publishes stable v2 protocol errors without weakening v1 codes', () => {
    expect(ApiErrorCodeSchema.options).toEqual(
      expect.arrayContaining([
        'EPISODE_NOT_FOUND',
        'SCENARIO_NOT_FOUND',
        'SCENARIO_VERSION_CONFLICT',
        'AGENT_NOT_FOUND',
        'RUN_NOT_FOUND',
        'RUN_ROLE_CONFLICT',
        'TASK_LEASE_STALE',
        'ARTIFACT_BASE_CONFLICT',
        'FEEDBACK_GRANT_SCOPE_MISMATCH',
        'RECEIPT_CHAIN_CONFLICT',
        'FORBIDDEN',
      ]),
    );
  });

  it('keeps collaboration commands strict, JSON-only, and unable to echo lease secrets in resources', () => {
    expect(TaskClaimRequestSchema.parse({ expectedVersion: 1 })).toEqual({
      expectedVersion: 1,
      leaseSeconds: 60,
    });
    expect(
      TaskClaimRequestSchema.safeParse({
        expectedVersion: 1,
        leaseSeconds: 60,
        runAgentId: '00000000-0000-4000-8000-000000000004',
      }).success,
    ).toBe(false);

    const leaseCommand = {
      expectedVersion: 2,
      claimEpoch: 1,
      leaseToken:
        'wlt_abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789',
    };
    expect(TaskLeaseCommandRequestSchema.safeParse(leaseCommand).success).toBe(
      true,
    );
    expect(
      TaskHeartbeatRequestSchema.safeParse({
        ...leaseCommand,
        extendBySeconds: 60,
      }).success,
    ).toBe(true);

    const submission = {
      ...leaseCommand,
      submissionType: 'water-evidence-result',
      targetScope: 'individual',
      payload: { nested: [1, true, null, { source: 'receipt' }] },
      receiptRefs: [
        {
          receiptId: '00000000-0000-4000-8000-000000000010',
          receiptHash:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
      artifactVersionRefs: [],
      endorsementRecipientRunAgentIds: [],
    };
    expect(
      CreateTaskSubmissionRequestSchema.safeParse(submission).success,
    ).toBe(true);
    expect(
      CreateTaskSubmissionRequestSchema.safeParse({
        ...submission,
        payload: { invalid: undefined },
      }).success,
    ).toBe(false);
    expect(
      CreateTaskSubmissionRequestSchema.safeParse({
        ...submission,
        receiptRefs: [],
      }).success,
    ).toBe(false);

    const task = {
      id: '00000000-0000-4000-8000-000000000005',
      runId: '00000000-0000-4000-8000-000000000003',
      roleSlotId: 'water-evidence',
      assignedRunAgentId: '00000000-0000-4000-8000-000000000004',
      definitionKey: 'analyze-water-evidence',
      title: text,
      objective: text,
      state: 'CLAIMED',
      lockVersion: 2,
      claimEpoch: 1,
      claimedByRunAgentId: '00000000-0000-4000-8000-000000000004',
      leaseExpiresAt: '2026-08-20T08:01:00.000Z',
      createdRunSeq: 4,
    };
    expect(RunTaskSchema.safeParse(task).success).toBe(true);
    expect(
      RunTaskSchema.safeParse({
        ...task,
        leaseToken: leaseCommand.leaseToken,
      }).success,
    ).toBe(false);
    expect(
      RunTaskSchema.safeParse({
        ...task,
        leaseTokenHash:
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }).success,
    ).toBe(false);

    expect(
      CreateRunMessageRequestSchema.safeParse({
        recipientRunAgentIds: [
          '00000000-0000-4000-8000-000000000004',
          '00000000-0000-4000-8000-000000000004',
        ],
        subject: text,
        body: text,
      }).success,
    ).toBe(false);
    const artifactVersionRef = {
      artifactId: '00000000-0000-4000-8000-000000000040',
      artifactVersionId: '00000000-0000-4000-8000-000000000041',
      contentHash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    expect(
      CreateRunMessageRequestSchema.parse({
        kind: 'request',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
        subject: text,
        body: text,
        artifactVersionRefs: [artifactVersionRef],
      }),
    ).toMatchObject({
      kind: 'request',
      artifactVersionRefs: [artifactVersionRef],
    });
    expect(
      CreateRunMessageRequestSchema.safeParse({
        kind: 'response',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
        subject: text,
        body: text,
      }).success,
    ).toBe(false);
    expect(
      CreateRunMessageRequestSchema.safeParse({
        kind: 'handoff',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
        subject: text,
        body: text,
        artifactVersionRefs: [],
      }).success,
    ).toBe(false);
    expect(
      CreateRunMessageRequestSchema.parse({
        kind: 'response',
        replyToMessageId: '00000000-0000-4000-8000-000000000042',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
        subject: text,
        body: text,
      }),
    ).toMatchObject({
      kind: 'response',
      replyToMessageId: '00000000-0000-4000-8000-000000000042',
    });
    expect(
      RunMessageSchema.parse({
        id: '00000000-0000-4000-8000-000000000043',
        runId: '00000000-0000-4000-8000-000000000003',
        threadId: '00000000-0000-4000-8000-000000000042',
        replyToMessageId: '00000000-0000-4000-8000-000000000042',
        kind: 'response',
        senderType: 'RUN_AGENT',
        senderId: '00000000-0000-4000-8000-000000000004',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000005'],
        subject: text,
        body: text,
        artifactVersionRefs: [],
        createdRunSeq: 12,
        createdVirtualAt: '2026-08-20T08:00:00.000Z',
        createdAt: '2026-08-20T08:00:01.000Z',
      }),
    ).toMatchObject({
      threadId: '00000000-0000-4000-8000-000000000042',
      kind: 'response',
    });
    expect(
      RunInteractionListSchema.parse({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000042',
            runId: '00000000-0000-4000-8000-000000000003',
            threadId: '00000000-0000-4000-8000-000000000042',
            kind: 'request',
            senderType: 'RUN_AGENT',
            senderId: '00000000-0000-4000-8000-000000000005',
            recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
            subject: text,
            artifactVersionRefs: [artifactVersionRef],
            createdRunSeq: 10,
            createdVirtualAt: '2026-08-20T08:00:00.000Z',
            createdAt: '2026-08-20T08:00:01.000Z',
            deliveries: [
              {
                recipientRunAgentId: '00000000-0000-4000-8000-000000000004',
                state: 'acknowledged',
                agentReceiptSeq: 4,
                issuedRunSeq: 11,
                acknowledgedRunSeq: 13,
              },
            ],
            responseMessageIds: ['00000000-0000-4000-8000-000000000043'],
            status: 'responded',
          },
        ],
      }),
    ).toMatchObject({ items: [{ status: 'responded' }] });
    expect(
      CreateRunArtifactRequestSchema.safeParse({
        artifactKey: 'water-evidence-register',
        artifactType: 'evidence-register',
        title: text,
        content: { rows: [] },
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
      }).success,
    ).toBe(true);
    expect(
      CreateArtifactVersionRequestSchema.safeParse({
        baseVersionId: '00000000-0000-4000-8000-000000000020',
        content: { complete: true },
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000004'],
      }).success,
    ).toBe(true);
    expect(
      FeedbackActionGrantSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000030',
        targetRunAgentId: '00000000-0000-4000-8000-000000000004',
        targetTaskId: '00000000-0000-4000-8000-000000000005',
        action: 'endorse',
        predecessorSubmissionId: '00000000-0000-4000-8000-000000000031',
        evaluationId: '00000000-0000-4000-8000-000000000032',
        issuedRunSeq: 9,
        issuedAt: '2026-08-20T08:00:00.000Z',
        maxUses: 1,
        usedCount: 0,
        scopeHash:
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        version: 1,
      }).success,
    ).toBe(true);
  });

  it('models an immutable Submission as a receipt-gated issued resource', () => {
    const submission = RunSubmissionSchema.parse({
      id: '00000000-0000-4000-8000-000000000020',
      runId: '00000000-0000-4000-8000-000000000003',
      taskId: '00000000-0000-4000-8000-000000000005',
      actorRunAgentId: '00000000-0000-4000-8000-000000000004',
      targetScope: 'team',
      roleSlotId: 'water-evidence',
      revisionNo: 1,
      submissionType: 'water-evidence-result',
      isFinal: false,
      payload: { conclusion: 'synthetic evidence ready' },
      payloadHash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      receiptRefs: [
        {
          receiptId: '00000000-0000-4000-8000-000000000011',
          receiptHash:
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
      artifactVersionRefs: [],
      endorsementRecipientRunAgentIds: ['00000000-0000-4000-8000-000000000014'],
      submittedVirtualAt: '2023-03-22T07:00:00.000Z',
      submittedAt: '2026-08-20T08:00:00.000Z',
      createdRunSeq: 12,
    });

    expect(RunResourceSchema.parse(submission)).toEqual(submission);
    expect(
      AgentViewReceiptSchema.parse({
        id: '00000000-0000-4000-8000-000000000021',
        runId: submission.runId,
        runAgentId: '00000000-0000-4000-8000-000000000014',
        agentReceiptSeq: 5,
        deliveryBatchId: '00000000-0000-4000-8000-000000000022',
        sourceEventId: '00000000-0000-4000-8000-000000000023',
        sourceRunSeq: submission.createdRunSeq,
        issuedEventId: '00000000-0000-4000-8000-000000000024',
        issuedRunSeq: 14,
        viewKind: 'submission',
        resourceType: 'submission',
        resourceId: submission.id,
        resourceVersion: String(submission.revisionNo),
        availableVirtualAt: submission.submittedVirtualAt,
        issuedVirtualAt: submission.submittedVirtualAt,
        issuedAt: submission.submittedAt,
        schemaVersion: 1,
        contentSnapshot: submission,
        contentHash:
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        previousReceiptHash:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        receiptHash:
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      }).contentSnapshot,
    ).toEqual(submission);
  });

  it('models deterministic v2 evaluations for operator diagnostics', () => {
    const evaluation = {
      id: '00000000-0000-4000-8000-000000000040',
      runId: '00000000-0000-4000-8000-000000000003',
      submissionId: '00000000-0000-4000-8000-000000000020',
      taskId: '00000000-0000-4000-8000-000000000005',
      runAgentId: '00000000-0000-4000-8000-000000000004',
      roleSlotId: 'water-evidence',
      targetScope: 'role',
      verdict: 'ACCEPTED',
      issueCodes: [],
      deterministic: true,
      evaluatorVersion: 'yongding-role-output-v1',
      createdRunSeq: 15,
      createdAt: '2026-08-20T08:00:00.000Z',
    } as const;

    expect(RunEvaluationListSchema.parse({ items: [evaluation] })).toEqual({
      items: [evaluation],
    });
  });
});
