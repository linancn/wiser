import { describe, expect, it } from 'vitest';

import {
  type AgentViewAcknowledgement,
  type DomainError,
  agentKnowledgeAt,
  appendAgentViewAcknowledgement,
  eligibleDisclosuresAt,
  issueAgentSyncBatch,
  verifyAgentReceiptChain,
  type AgentDisclosureGrant,
} from '../src/index.js';

const testHash = (canonical: string) => `test-hash:${canonical}`;
const virtualNow = '2023-03-22T07:10:00.000Z';

const disclosures: readonly AgentDisclosureGrant[] = [
  {
    id: 'disclosure-inject-a',
    runId: 'run-yongding-001',
    runAgentId: 'agent-a',
    sourceEventId: 'event-inject-a',
    sourceRunSeq: 10,
    grantedRunSeq: 11,
    viewKind: 'inject',
    resourceType: 'inject',
    resourceId: 'inject-a',
    resourceVersion: 'v1',
    availableVirtualAt: '2023-03-22T07:00:00.000Z',
    schemaVersion: 1,
    contentHash: 'sha256:inject-a',
    contentSnapshot: { text: 'agent-a-only' },
  },
  {
    id: 'disclosure-future',
    runId: 'run-yongding-001',
    runAgentId: 'agent-a',
    sourceEventId: 'event-future',
    sourceRunSeq: 30,
    grantedRunSeq: 31,
    viewKind: 'inject',
    resourceType: 'inject',
    resourceId: 'inject-future',
    resourceVersion: 'v1',
    availableVirtualAt: '2023-03-22T08:00:00.000Z',
    schemaVersion: 1,
    contentHash: 'sha256:future',
    contentSnapshot: { text: 'future' },
  },
  {
    id: 'disclosure-other-agent',
    runId: 'run-yongding-001',
    runAgentId: 'agent-b',
    sourceEventId: 'event-private-b',
    sourceRunSeq: 8,
    grantedRunSeq: 9,
    viewKind: 'message',
    resourceType: 'message',
    resourceId: 'message-b',
    resourceVersion: 'v1',
    availableVirtualAt: '2023-03-22T07:00:00.000Z',
    schemaVersion: 1,
    contentHash: 'sha256:message-b',
    contentSnapshot: { text: 'agent-b-only' },
  },
];

function issueFirstBatch() {
  return issueAgentSyncBatch({
    runId: 'run-yongding-001',
    runAgentId: 'agent-a',
    eligibilityCutoffRunSeq: 20,
    responseRunCursor: 22,
    currentVirtualTime: virtualNow,
    afterReceiptSeq: 0,
    maxItems: 50,
    idempotencyKey: 'sync-key-1',
    requestHash: 'sha256:sync-request-1',
    deliveryBatchId: 'batch-1',
    issuedAt: '2023-03-22T07:10:01.000Z',
    issuedVirtualAt: virtualNow,
    chainHead: {
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      lastReceiptSeq: 0,
      headHash: 'receipt-genesis',
    },
    existingReceipts: [],
    existingBatches: [],
    disclosures,
    issuanceCoordinates: [
      {
        disclosureId: 'disclosure-inject-a',
        receiptId: 'receipt-1',
        issuedEventId: 'event-receipt-1',
        issuedRunSeq: 21,
      },
    ],
    hashCanonical: testHash,
  });
}

describe('/sync eligibility, issuance and idempotency', () => {
  it('represents an empty delivery batch without an inverted Receipt range', () => {
    const decision = issueAgentSyncBatch({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      eligibilityCutoffRunSeq: 20,
      responseRunCursor: 20,
      currentVirtualTime: virtualNow,
      afterReceiptSeq: 0,
      maxItems: 50,
      idempotencyKey: 'sync-empty',
      requestHash: 'sha256:sync-empty',
      deliveryBatchId: 'batch-empty',
      issuedAt: '2023-03-22T07:10:01.000Z',
      issuedVirtualAt: virtualNow,
      chainHead: {
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        lastReceiptSeq: 0,
        headHash: 'receipt-genesis',
      },
      existingReceipts: [],
      existingBatches: [],
      disclosures: [],
      issuanceCoordinates: [],
      hashCanonical: testHash,
    });

    expect(decision.batch).toMatchObject({
      fromReceiptSeq: null,
      throughReceiptSeq: 0,
      receipts: [],
      hasMore: false,
    });
  });

  it('copies Receipt content so the issued hash chain cannot be rewritten by its caller', () => {
    const contentSnapshot = { nested: { text: 'original' } };
    const decision = issueAgentSyncBatch({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      eligibilityCutoffRunSeq: 20,
      responseRunCursor: 22,
      currentVirtualTime: virtualNow,
      afterReceiptSeq: 0,
      maxItems: 50,
      idempotencyKey: 'sync-immutable',
      requestHash: 'sha256:sync-immutable',
      deliveryBatchId: 'batch-immutable',
      issuedAt: '2023-03-22T07:10:01.000Z',
      issuedVirtualAt: virtualNow,
      chainHead: {
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        lastReceiptSeq: 0,
        headHash: 'receipt-genesis',
      },
      existingReceipts: [],
      existingBatches: [],
      disclosures: [{ ...disclosures[0]!, contentSnapshot }],
      issuanceCoordinates: [
        {
          disclosureId: 'disclosure-inject-a',
          receiptId: 'receipt-immutable',
          issuedEventId: 'event-receipt-immutable',
          issuedRunSeq: 21,
        },
      ],
      hashCanonical: testHash,
    });

    contentSnapshot.nested.text = 'rewritten';

    expect(decision.receipts[0]?.contentSnapshot).toEqual({
      nested: { text: 'original' },
    });
    expect(
      verifyAgentReceiptChain({
        receipts: decision.receipts,
        genesisHash: 'receipt-genesis',
        hashCanonical: testHash,
      }).valid,
    ).toBe(true);
  });

  it('turns only currently eligible, unissued disclosures into chained immutable receipts', () => {
    expect(
      eligibleDisclosuresAt({
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        cutoffRunSeq: 20,
        virtualTime: virtualNow,
        disclosures,
        existingReceipts: [],
      }).map(({ id }) => id),
    ).toEqual(['disclosure-inject-a']);

    const decision = issueFirstBatch();

    expect(decision.replayed).toBe(false);
    expect(decision.batch).toMatchObject({
      id: 'batch-1',
      fromReceiptSeq: 1,
      throughReceiptSeq: 1,
      runCursor: 22,
      hasMore: false,
      receiptHeadHash: decision.receipts[0]?.receiptHash,
    });
    expect(decision.receipts).toHaveLength(1);
    expect(decision.receipts[0]).toMatchObject({
      id: 'receipt-1',
      disclosureId: 'disclosure-inject-a',
      agentReceiptSeq: 1,
      previousReceiptHash: 'receipt-genesis',
      issuedRunSeq: 21,
    });
    expect(decision.chainHead).toEqual({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      lastReceiptSeq: 1,
      headHash: decision.receipts[0]?.receiptHash,
    });
    expect(
      verifyAgentReceiptChain({
        receipts: decision.receipts,
        genesisHash: 'receipt-genesis',
        hashCanonical: testHash,
      }),
    ).toEqual({ valid: true, throughReceiptSeq: 1 });
  });

  it('replays the original batch for the same key/hash and conflicts on key reuse', () => {
    const first = issueFirstBatch();
    const retried = issueAgentSyncBatch({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      eligibilityCutoffRunSeq: 40,
      responseRunCursor: 42,
      currentVirtualTime: '2023-03-22T08:10:00.000Z',
      afterReceiptSeq: 1,
      maxItems: 50,
      idempotencyKey: 'sync-key-1',
      requestHash: 'sha256:sync-request-1',
      deliveryBatchId: 'ignored-on-retry',
      issuedAt: '2023-03-22T08:10:01.000Z',
      issuedVirtualAt: '2023-03-22T08:10:00.000Z',
      chainHead: first.chainHead,
      existingReceipts: first.receipts,
      existingBatches: first.batches,
      disclosures,
      issuanceCoordinates: [],
      hashCanonical: testHash,
    });

    expect(retried.replayed).toBe(true);
    expect(retried.batch).toEqual(first.batch);
    expect(retried.receipts).toEqual(first.receipts);
    expect(() =>
      issueAgentSyncBatch({
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        eligibilityCutoffRunSeq: 20,
        responseRunCursor: 22,
        currentVirtualTime: virtualNow,
        afterReceiptSeq: 1,
        maxItems: 50,
        idempotencyKey: 'sync-key-1',
        requestHash: 'sha256:different-request',
        deliveryBatchId: 'batch-conflict',
        issuedAt: '2023-03-22T07:10:01.000Z',
        issuedVirtualAt: virtualNow,
        chainHead: first.chainHead,
        existingReceipts: first.receipts,
        existingBatches: first.batches,
        disclosures,
        issuanceCoordinates: [],
        hashCanonical: testHash,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'IDEMPOTENCY_CONFLICT',
      }),
    );
  });
});

describe('append-only acknowledgement and Agent knowledge-set', () => {
  it('validates the exact Receipt chain head and appends acknowledgement without rewriting receipts', () => {
    const issued = issueFirstBatch();
    const receiptsBefore = structuredClone(issued.receipts);
    const appended = appendAgentViewAcknowledgement({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      deliveryBatchId: 'batch-1',
      throughReceiptSeq: 1,
      acknowledgedHeadHash: issued.chainHead.headHash,
      acknowledgementId: 'ack-1',
      acknowledgedEventId: 'event-ack-1',
      acknowledgedRunSeq: 23,
      acknowledgedAt: '2023-03-22T07:10:02.000Z',
      commandReceiptId: 'command-receipt-ack-1',
      idempotencyKey: 'ack-key-1',
      requestHash: 'sha256:ack-request-1',
      receipts: issued.receipts,
      existingAcknowledgements: [],
    });

    expect(appended.replayed).toBe(false);
    expect(appended.acknowledgements).toHaveLength(1);
    expect(appended.acknowledgement).toMatchObject({
      id: 'ack-1',
      throughReceiptSeq: 1,
      acknowledgedHeadHash: issued.chainHead.headHash,
    });
    expect(issued.receipts).toEqual(receiptsBefore);

    const retried = appendAgentViewAcknowledgement({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      deliveryBatchId: 'batch-1',
      throughReceiptSeq: 1,
      acknowledgedHeadHash: issued.chainHead.headHash,
      acknowledgementId: 'ignored',
      acknowledgedEventId: 'ignored',
      acknowledgedRunSeq: 24,
      acknowledgedAt: '2023-03-22T07:10:03.000Z',
      commandReceiptId: 'ignored',
      idempotencyKey: 'ack-key-1',
      requestHash: 'sha256:ack-request-1',
      receipts: issued.receipts,
      existingAcknowledgements: appended.acknowledgements,
    });
    expect(retried.replayed).toBe(true);
    expect(retried.acknowledgement).toEqual(appended.acknowledgement);
  });

  it('rejects a fabricated or out-of-range acknowledgement head', () => {
    const issued = issueFirstBatch();
    const base = {
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      deliveryBatchId: 'batch-1',
      acknowledgementId: 'ack-1',
      acknowledgedEventId: 'event-ack-1',
      acknowledgedRunSeq: 23,
      acknowledgedAt: '2023-03-22T07:10:02.000Z',
      commandReceiptId: 'command-receipt-ack-1',
      idempotencyKey: 'ack-key-1',
      requestHash: 'sha256:ack-request-1',
      receipts: issued.receipts,
      existingAcknowledgements: [] as readonly AgentViewAcknowledgement[],
    };

    expect(() =>
      appendAgentViewAcknowledgement({
        ...base,
        throughReceiptSeq: 1,
        acknowledgedHeadHash: 'fabricated',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'ACKNOWLEDGEMENT_HEAD_MISMATCH',
      }),
    );
    expect(() =>
      appendAgentViewAcknowledgement({
        ...base,
        throughReceiptSeq: 2,
        acknowledgedHeadHash: issued.chainHead.headHash,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'ACKNOWLEDGEMENT_RECEIPT_OUT_OF_RANGE',
      }),
    );
  });

  it('builds knowledge from accepted authored facts plus issued or acknowledged Receipts, never eligibility', () => {
    const issued = issueFirstBatch();
    const acknowledgement = appendAgentViewAcknowledgement({
      runId: 'run-yongding-001',
      runAgentId: 'agent-a',
      deliveryBatchId: 'batch-1',
      throughReceiptSeq: 1,
      acknowledgedHeadHash: issued.chainHead.headHash,
      acknowledgementId: 'ack-1',
      acknowledgedEventId: 'event-ack-1',
      acknowledgedRunSeq: 23,
      acknowledgedAt: '2023-03-22T07:10:02.000Z',
      commandReceiptId: 'command-receipt-ack-1',
      idempotencyKey: 'ack-key-1',
      requestHash: 'sha256:ack-request-1',
      receipts: issued.receipts,
      existingAcknowledgements: [],
    }).acknowledgements;
    const authoredFacts = [
      {
        id: 'fact-submission-a',
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        acceptedRunSeq: 5,
        resourceType: 'submission',
        resourceId: 'submission-a',
        resourceVersion: 'v1',
      },
      {
        id: 'fact-private-b',
        runId: 'run-yongding-001',
        runAgentId: 'agent-b',
        acceptedRunSeq: 4,
        resourceType: 'message',
        resourceId: 'message-b',
        resourceVersion: 'v1',
      },
    ] as const;

    expect(
      agentKnowledgeAt({
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        cutoffRunSeq: 22,
        deliverySemantics: 'issued',
        authoredFacts,
        receipts: issued.receipts,
        acknowledgements: acknowledgement,
      }).map(({ resourceId, provenance }) => ({ resourceId, provenance })),
    ).toEqual([
      { resourceId: 'submission-a', provenance: 'authored' },
      { resourceId: 'inject-a', provenance: 'issued' },
    ]);
    expect(
      agentKnowledgeAt({
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        cutoffRunSeq: 22,
        deliverySemantics: 'acknowledged',
        authoredFacts,
        receipts: issued.receipts,
        acknowledgements: acknowledgement,
      }).map(({ resourceId }) => resourceId),
    ).toEqual(['submission-a']);
    expect(
      agentKnowledgeAt({
        runId: 'run-yongding-001',
        runAgentId: 'agent-a',
        cutoffRunSeq: 23,
        deliverySemantics: 'acknowledged',
        authoredFacts,
        receipts: issued.receipts,
        acknowledgements: acknowledgement,
      }).map(({ resourceId, provenance }) => ({ resourceId, provenance })),
    ).toEqual([
      { resourceId: 'submission-a', provenance: 'authored' },
      { resourceId: 'inject-a', provenance: 'acknowledged' },
    ]);
  });
});
