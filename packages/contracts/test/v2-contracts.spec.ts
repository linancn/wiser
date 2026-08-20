import { describe, expect, it } from 'vitest';

import {
  AgentIdentitySchema,
  AgentVersionSchema,
  ApiErrorCodeSchema,
  BestEffortTelemetryOverlaySchema,
  ManageScenarioSummarySchema,
  PublicScenarioSummarySchema,
  RunAgentSchema,
  RunAuthoritativeProjectionSchema,
  RunSchema,
  RunSyncRequestSchema,
  RunTaskSchema,
  SyncDeliveryBatchSchema,
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
        'RECEIPT_CHAIN_CONFLICT',
        'FORBIDDEN',
      ]),
    );
  });
});
