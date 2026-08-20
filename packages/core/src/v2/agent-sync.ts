import {
  canonicalJson,
  type CanonicalJsonValue,
  cloneAndFreezeCanonicalJson,
  fail,
  freezeArray,
  requireNonEmpty,
  toEpoch,
} from './shared.js';

export interface AgentDisclosureGrant {
  readonly id: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly sourceEventId: string;
  readonly sourceRunSeq: number;
  readonly grantedRunSeq: number;
  readonly revokedRunSeq?: number;
  readonly viewKind: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly availableVirtualAt: string;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly contentSnapshot?: CanonicalJsonValue;
  readonly contentBlobRef?: string;
}

export interface AgentViewReceipt {
  readonly id: string;
  readonly disclosureId: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly agentReceiptSeq: number;
  readonly deliveryBatchId: string;
  readonly sourceEventId: string;
  readonly sourceRunSeq: number;
  readonly issuedEventId: string;
  readonly issuedRunSeq: number;
  readonly viewKind: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly availableVirtualAt: string;
  readonly issuedVirtualAt: string;
  readonly issuedAt: string;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly contentSnapshot?: CanonicalJsonValue;
  readonly contentBlobRef?: string;
  readonly previousReceiptHash: string;
  readonly receiptHash: string;
}

export interface AgentReceiptChainHead {
  readonly runId: string;
  readonly runAgentId: string;
  readonly lastReceiptSeq: number;
  readonly headHash: string;
}

export interface AgentSyncDeliveryBatch {
  readonly id: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly afterReceiptSeq: number;
  readonly fromReceiptSeq: number;
  readonly throughReceiptSeq: number;
  readonly receiptHeadHash: string;
  readonly runCursor: number;
  readonly hasMore: boolean;
  readonly receipts: readonly AgentViewReceipt[];
}

export interface ReceiptIssuanceCoordinate {
  readonly disclosureId: string;
  readonly receiptId: string;
  readonly issuedEventId: string;
  readonly issuedRunSeq: number;
}

export interface AgentSyncIssueDecision {
  readonly batch: AgentSyncDeliveryBatch;
  readonly receipts: readonly AgentViewReceipt[];
  readonly batches: readonly AgentSyncDeliveryBatch[];
  readonly chainHead: AgentReceiptChainHead;
  readonly replayed: boolean;
}

export interface AgentViewAcknowledgement {
  readonly id: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly deliveryBatchId: string;
  readonly throughReceiptSeq: number;
  readonly acknowledgedHeadHash: string;
  readonly acknowledgedEventId: string;
  readonly acknowledgedRunSeq: number;
  readonly acknowledgedAt: string;
  readonly commandReceiptId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface AgentAuthoredKnowledgeFact {
  readonly id: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly acceptedRunSeq: number;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
}

export interface AgentKnowledgeItem {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly evidenceRunSeq: number;
  readonly provenance: 'authored' | 'issued' | 'acknowledged';
}

function receiptHashMaterial(
  receipt: Omit<AgentViewReceipt, 'receiptHash'>,
): CanonicalJsonValue {
  return {
    id: receipt.id,
    disclosureId: receipt.disclosureId,
    runId: receipt.runId,
    runAgentId: receipt.runAgentId,
    agentReceiptSeq: receipt.agentReceiptSeq,
    deliveryBatchId: receipt.deliveryBatchId,
    sourceEventId: receipt.sourceEventId,
    sourceRunSeq: receipt.sourceRunSeq,
    issuedEventId: receipt.issuedEventId,
    issuedRunSeq: receipt.issuedRunSeq,
    viewKind: receipt.viewKind,
    resourceType: receipt.resourceType,
    resourceId: receipt.resourceId,
    resourceVersion: receipt.resourceVersion,
    availableVirtualAt: receipt.availableVirtualAt,
    issuedVirtualAt: receipt.issuedVirtualAt,
    issuedAt: receipt.issuedAt,
    schemaVersion: receipt.schemaVersion,
    contentHash: receipt.contentHash,
    previousReceiptHash: receipt.previousReceiptHash,
    ...(receipt.contentSnapshot === undefined
      ? {}
      : { contentSnapshot: receipt.contentSnapshot }),
    ...(receipt.contentBlobRef === undefined
      ? {}
      : { contentBlobRef: receipt.contentBlobRef }),
  };
}

function assertSyncIdentity(input: {
  expectedRunId: string;
  expectedRunAgentId: string;
  actualRunId: string;
  actualRunAgentId: string;
  resource: string;
}): void {
  if (
    input.expectedRunId !== input.actualRunId ||
    input.expectedRunAgentId !== input.actualRunAgentId
  ) {
    fail(
      'SYNC_IDENTITY_MISMATCH',
      `${input.resource} belongs to a different Run or RunAgent.`,
    );
  }
}

export function eligibleDisclosuresAt(input: {
  runId: string;
  runAgentId: string;
  cutoffRunSeq: number;
  virtualTime: string;
  disclosures: readonly AgentDisclosureGrant[];
  existingReceipts: readonly AgentViewReceipt[];
}): readonly AgentDisclosureGrant[] {
  const virtualTime = toEpoch(input.virtualTime, 'virtualTime');
  const issuedDisclosureIds = new Set(
    input.existingReceipts
      .filter(
        (receipt) =>
          receipt.runId === input.runId &&
          receipt.runAgentId === input.runAgentId,
      )
      .map(({ disclosureId }) => disclosureId),
  );
  return freezeArray(
    input.disclosures
      .filter(
        (disclosure) =>
          disclosure.runId === input.runId &&
          disclosure.runAgentId === input.runAgentId &&
          disclosure.sourceRunSeq <= input.cutoffRunSeq &&
          disclosure.grantedRunSeq <= input.cutoffRunSeq &&
          (disclosure.revokedRunSeq === undefined ||
            disclosure.revokedRunSeq > input.cutoffRunSeq) &&
          toEpoch(
            disclosure.availableVirtualAt,
            'disclosure.availableVirtualAt',
          ) <= virtualTime &&
          !issuedDisclosureIds.has(disclosure.id),
      )
      .sort(
        (left, right) =>
          left.grantedRunSeq - right.grantedRunSeq ||
          left.sourceRunSeq - right.sourceRunSeq ||
          left.id.localeCompare(right.id),
      ),
  );
}

function assertCurrentReceiptHead(input: {
  head: AgentReceiptChainHead;
  receipts: readonly AgentViewReceipt[];
}): void {
  const scoped = input.receipts
    .filter(
      (receipt) =>
        receipt.runId === input.head.runId &&
        receipt.runAgentId === input.head.runAgentId,
    )
    .sort((left, right) => left.agentReceiptSeq - right.agentReceiptSeq);
  const latest = scoped.at(-1);
  if (latest === undefined) {
    if (input.head.lastReceiptSeq !== 0) {
      fail(
        'RECEIPT_HEAD_CONFLICT',
        'A non-genesis Receipt head has no matching Receipt.',
      );
    }
    return;
  }
  if (
    latest.agentReceiptSeq !== input.head.lastReceiptSeq ||
    latest.receiptHash !== input.head.headHash
  ) {
    fail(
      'RECEIPT_HEAD_CONFLICT',
      'The Receipt chain head does not match the latest stored Receipt.',
    );
  }
}

export function issueAgentSyncBatch(input: {
  runId: string;
  runAgentId: string;
  eligibilityCutoffRunSeq: number;
  responseRunCursor: number;
  currentVirtualTime: string;
  afterReceiptSeq: number;
  maxItems: number;
  idempotencyKey: string;
  requestHash: string;
  deliveryBatchId: string;
  issuedAt: string;
  issuedVirtualAt: string;
  chainHead: AgentReceiptChainHead;
  existingReceipts: readonly AgentViewReceipt[];
  existingBatches: readonly AgentSyncDeliveryBatch[];
  disclosures: readonly AgentDisclosureGrant[];
  issuanceCoordinates: readonly ReceiptIssuanceCoordinate[];
  hashCanonical: (canonical: string) => string;
}): AgentSyncIssueDecision {
  requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
  requireNonEmpty(input.requestHash, 'requestHash');
  const existingBatch = input.existingBatches.find(
    (batch) =>
      batch.runId === input.runId &&
      batch.runAgentId === input.runAgentId &&
      batch.idempotencyKey === input.idempotencyKey,
  );
  if (existingBatch !== undefined) {
    if (existingBatch.requestHash !== input.requestHash) {
      fail(
        'IDEMPOTENCY_CONFLICT',
        'The sync idempotency key was already used for a different request.',
      );
    }
    return Object.freeze({
      batch: existingBatch,
      receipts: freezeArray(input.existingReceipts),
      batches: freezeArray(input.existingBatches),
      chainHead: Object.freeze({ ...input.chainHead }),
      replayed: true,
    });
  }

  assertSyncIdentity({
    expectedRunId: input.runId,
    expectedRunAgentId: input.runAgentId,
    actualRunId: input.chainHead.runId,
    actualRunAgentId: input.chainHead.runAgentId,
    resource: 'Receipt head',
  });
  assertCurrentReceiptHead({
    head: input.chainHead,
    receipts: input.existingReceipts,
  });
  if (!Number.isInteger(input.maxItems) || input.maxItems < 1) {
    fail('INVALID_SYNC_LIMIT', 'maxItems must be a positive integer.');
  }
  if (
    !Number.isInteger(input.afterReceiptSeq) ||
    input.afterReceiptSeq < 0 ||
    input.afterReceiptSeq > input.chainHead.lastReceiptSeq
  ) {
    fail(
      'SYNC_CURSOR_OUT_OF_RANGE',
      'afterReceiptSeq cannot be ahead of the Receipt chain head.',
    );
  }
  if (input.responseRunCursor < input.eligibilityCutoffRunSeq) {
    fail(
      'INVALID_SYNC_RUN_CURSOR',
      'The response Run cursor cannot precede the eligibility cutoff.',
    );
  }
  toEpoch(input.issuedAt, 'issuedAt');
  toEpoch(input.issuedVirtualAt, 'issuedVirtualAt');
  requireNonEmpty(input.deliveryBatchId, 'deliveryBatchId');

  const eligible = eligibleDisclosuresAt({
    runId: input.runId,
    runAgentId: input.runAgentId,
    cutoffRunSeq: input.eligibilityCutoffRunSeq,
    virtualTime: input.currentVirtualTime,
    disclosures: input.disclosures,
    existingReceipts: input.existingReceipts,
  });
  const selected = eligible.slice(0, input.maxItems);
  const selectedIds = new Set(selected.map(({ id }) => id));
  const coordinateByDisclosure = new Map(
    input.issuanceCoordinates.map((coordinate) => [
      coordinate.disclosureId,
      coordinate,
    ]),
  );
  if (
    coordinateByDisclosure.size !== input.issuanceCoordinates.length ||
    input.issuanceCoordinates.some(
      ({ disclosureId }) => !selectedIds.has(disclosureId),
    )
  ) {
    fail(
      'INVALID_RECEIPT_ISSUANCE_COORDINATES',
      'Issuance coordinates must map exactly to selected disclosures.',
    );
  }

  let previousReceiptHash = input.chainHead.headHash;
  const issuedReceipts: AgentViewReceipt[] = [];
  for (const [index, disclosure] of selected.entries()) {
    const coordinate = coordinateByDisclosure.get(disclosure.id);
    if (coordinate === undefined) {
      fail(
        'MISSING_RECEIPT_ISSUANCE_COORDINATE',
        `Disclosure ${disclosure.id} has no Receipt issuance coordinate.`,
      );
    }
    if (
      !Number.isInteger(coordinate.issuedRunSeq) ||
      coordinate.issuedRunSeq <= input.eligibilityCutoffRunSeq ||
      coordinate.issuedRunSeq > input.responseRunCursor
    ) {
      fail(
        'INVALID_RECEIPT_ISSUED_RUN_SEQ',
        'Receipt issuance must occur after eligibility and at/before the response cursor.',
      );
    }
    if (
      (disclosure.contentSnapshot === undefined) ===
      (disclosure.contentBlobRef === undefined)
    ) {
      fail(
        'INVALID_DISCLOSURE_CONTENT',
        'A disclosure needs exactly one content snapshot or blob reference.',
      );
    }
    const receiptWithoutHash = Object.freeze({
      id: coordinate.receiptId,
      disclosureId: disclosure.id,
      runId: input.runId,
      runAgentId: input.runAgentId,
      agentReceiptSeq: input.chainHead.lastReceiptSeq + index + 1,
      deliveryBatchId: input.deliveryBatchId,
      sourceEventId: disclosure.sourceEventId,
      sourceRunSeq: disclosure.sourceRunSeq,
      issuedEventId: coordinate.issuedEventId,
      issuedRunSeq: coordinate.issuedRunSeq,
      viewKind: disclosure.viewKind,
      resourceType: disclosure.resourceType,
      resourceId: disclosure.resourceId,
      resourceVersion: disclosure.resourceVersion,
      availableVirtualAt: disclosure.availableVirtualAt,
      issuedVirtualAt: input.issuedVirtualAt,
      issuedAt: input.issuedAt,
      schemaVersion: disclosure.schemaVersion,
      contentHash: disclosure.contentHash,
      ...(disclosure.contentSnapshot === undefined
        ? {}
        : {
            contentSnapshot: cloneAndFreezeCanonicalJson(
              disclosure.contentSnapshot,
            ),
          }),
      ...(disclosure.contentBlobRef === undefined
        ? {}
        : { contentBlobRef: disclosure.contentBlobRef }),
      previousReceiptHash,
    });
    const receiptHash = input.hashCanonical(
      canonicalJson(receiptHashMaterial(receiptWithoutHash)),
    );
    requireNonEmpty(receiptHash, 'receiptHash');
    const receipt = Object.freeze({ ...receiptWithoutHash, receiptHash });
    issuedReceipts.push(receipt);
    previousReceiptHash = receiptHash;
  }

  const throughReceiptSeq =
    input.chainHead.lastReceiptSeq + issuedReceipts.length;
  const frozenIssuedReceipts = freezeArray(issuedReceipts);
  const batch = Object.freeze({
    id: input.deliveryBatchId,
    runId: input.runId,
    runAgentId: input.runAgentId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    afterReceiptSeq: input.afterReceiptSeq,
    fromReceiptSeq: input.chainHead.lastReceiptSeq + 1,
    throughReceiptSeq,
    receiptHeadHash: previousReceiptHash,
    runCursor: input.responseRunCursor,
    hasMore: eligible.length > issuedReceipts.length,
    receipts: frozenIssuedReceipts,
  });
  return Object.freeze({
    batch,
    receipts: freezeArray([...input.existingReceipts, ...issuedReceipts]),
    batches: freezeArray([...input.existingBatches, batch]),
    chainHead: Object.freeze({
      runId: input.runId,
      runAgentId: input.runAgentId,
      lastReceiptSeq: throughReceiptSeq,
      headHash: previousReceiptHash,
    }),
    replayed: false,
  });
}

export function verifyAgentReceiptChain(input: {
  receipts: readonly AgentViewReceipt[];
  genesisHash: string;
  hashCanonical: (canonical: string) => string;
}):
  | { readonly valid: true; readonly throughReceiptSeq: number }
  | {
      readonly valid: false;
      readonly throughReceiptSeq: number;
      readonly reason: string;
    } {
  let previousHash = input.genesisHash;
  let expectedSeq = 1;
  for (const receipt of input.receipts) {
    if (
      receipt.agentReceiptSeq !== expectedSeq ||
      receipt.previousReceiptHash !== previousHash
    ) {
      return Object.freeze({
        valid: false,
        throughReceiptSeq: expectedSeq - 1,
        reason: 'RECEIPT_SEQUENCE_OR_PREVIOUS_HASH_MISMATCH',
      });
    }
    const expectedHash = input.hashCanonical(
      canonicalJson(receiptHashMaterial(receipt)),
    );
    if (expectedHash !== receipt.receiptHash) {
      return Object.freeze({
        valid: false,
        throughReceiptSeq: expectedSeq - 1,
        reason: 'RECEIPT_HASH_MISMATCH',
      });
    }
    previousHash = receipt.receiptHash;
    expectedSeq += 1;
  }
  return Object.freeze({
    valid: true,
    throughReceiptSeq: expectedSeq - 1,
  });
}

export function appendAgentViewAcknowledgement(input: {
  runId: string;
  runAgentId: string;
  deliveryBatchId: string;
  throughReceiptSeq: number;
  acknowledgedHeadHash: string;
  acknowledgementId: string;
  acknowledgedEventId: string;
  acknowledgedRunSeq: number;
  acknowledgedAt: string;
  commandReceiptId: string;
  idempotencyKey: string;
  requestHash: string;
  receipts: readonly AgentViewReceipt[];
  existingAcknowledgements: readonly AgentViewAcknowledgement[];
}): {
  readonly acknowledgement: AgentViewAcknowledgement;
  readonly acknowledgements: readonly AgentViewAcknowledgement[];
  readonly replayed: boolean;
} {
  requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
  requireNonEmpty(input.requestHash, 'requestHash');
  const existing = input.existingAcknowledgements.find(
    (acknowledgement) =>
      acknowledgement.runId === input.runId &&
      acknowledgement.runAgentId === input.runAgentId &&
      acknowledgement.idempotencyKey === input.idempotencyKey,
  );
  if (existing !== undefined) {
    if (existing.requestHash !== input.requestHash) {
      fail(
        'IDEMPOTENCY_CONFLICT',
        'The acknowledgement idempotency key was already used for a different request.',
      );
    }
    return Object.freeze({
      acknowledgement: existing,
      acknowledgements: freezeArray(input.existingAcknowledgements),
      replayed: true,
    });
  }

  const receipt = input.receipts.find(
    (candidate) =>
      candidate.runId === input.runId &&
      candidate.runAgentId === input.runAgentId &&
      candidate.agentReceiptSeq === input.throughReceiptSeq,
  );
  if (receipt === undefined) {
    fail(
      'ACKNOWLEDGEMENT_RECEIPT_OUT_OF_RANGE',
      'The acknowledgement sequence does not identify this Agent Receipt chain.',
    );
  }
  if (receipt.receiptHash !== input.acknowledgedHeadHash) {
    fail(
      'ACKNOWLEDGEMENT_HEAD_MISMATCH',
      'The acknowledgement hash does not match the exact Receipt chain head.',
    );
  }
  if (receipt.deliveryBatchId !== input.deliveryBatchId) {
    fail(
      'ACKNOWLEDGEMENT_BATCH_MISMATCH',
      'The acknowledgement does not identify the batch containing its chain head.',
    );
  }
  const previousThrough = input.existingAcknowledgements
    .filter(
      (acknowledgement) =>
        acknowledgement.runId === input.runId &&
        acknowledgement.runAgentId === input.runAgentId,
    )
    .reduce(
      (maximum, acknowledgement) =>
        Math.max(maximum, acknowledgement.throughReceiptSeq),
      0,
    );
  if (input.throughReceiptSeq < previousThrough) {
    fail(
      'ACKNOWLEDGEMENT_REGRESSION',
      'An acknowledgement cannot move the Agent Receipt cursor backwards.',
    );
  }
  if (
    !Number.isInteger(input.acknowledgedRunSeq) ||
    input.acknowledgedRunSeq < receipt.issuedRunSeq
  ) {
    fail(
      'INVALID_ACKNOWLEDGED_RUN_SEQ',
      'An acknowledgement event cannot precede Receipt issuance.',
    );
  }
  toEpoch(input.acknowledgedAt, 'acknowledgedAt');
  const acknowledgement = Object.freeze({
    id: input.acknowledgementId,
    runId: input.runId,
    runAgentId: input.runAgentId,
    deliveryBatchId: input.deliveryBatchId,
    throughReceiptSeq: input.throughReceiptSeq,
    acknowledgedHeadHash: input.acknowledgedHeadHash,
    acknowledgedEventId: input.acknowledgedEventId,
    acknowledgedRunSeq: input.acknowledgedRunSeq,
    acknowledgedAt: input.acknowledgedAt,
    commandReceiptId: input.commandReceiptId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  });
  return Object.freeze({
    acknowledgement,
    acknowledgements: freezeArray([
      ...input.existingAcknowledgements,
      acknowledgement,
    ]),
    replayed: false,
  });
}

export function agentKnowledgeAt(input: {
  runId: string;
  runAgentId: string;
  cutoffRunSeq: number;
  deliverySemantics: 'issued' | 'acknowledged';
  authoredFacts: readonly AgentAuthoredKnowledgeFact[];
  receipts: readonly AgentViewReceipt[];
  acknowledgements: readonly AgentViewAcknowledgement[];
}): readonly AgentKnowledgeItem[] {
  const authored = input.authoredFacts
    .filter(
      (fact) =>
        fact.runId === input.runId &&
        fact.runAgentId === input.runAgentId &&
        fact.acceptedRunSeq <= input.cutoffRunSeq,
    )
    .sort((left, right) => left.acceptedRunSeq - right.acceptedRunSeq)
    .map((fact): AgentKnowledgeItem =>
      Object.freeze({
        resourceType: fact.resourceType,
        resourceId: fact.resourceId,
        resourceVersion: fact.resourceVersion,
        evidenceRunSeq: fact.acceptedRunSeq,
        provenance: 'authored',
      }),
    );

  const acknowledgedThrough = input.acknowledgements
    .filter(
      (acknowledgement) =>
        acknowledgement.runId === input.runId &&
        acknowledgement.runAgentId === input.runAgentId &&
        acknowledgement.acknowledgedRunSeq <= input.cutoffRunSeq,
    )
    .reduce(
      (maximum, acknowledgement) =>
        Math.max(maximum, acknowledgement.throughReceiptSeq),
      0,
    );
  const received = input.receipts
    .filter(
      (receipt) =>
        receipt.runId === input.runId &&
        receipt.runAgentId === input.runAgentId &&
        receipt.issuedRunSeq <= input.cutoffRunSeq &&
        (input.deliverySemantics === 'issued' ||
          receipt.agentReceiptSeq <= acknowledgedThrough),
    )
    .sort((left, right) => left.agentReceiptSeq - right.agentReceiptSeq)
    .map((receipt): AgentKnowledgeItem =>
      Object.freeze({
        resourceType: receipt.resourceType,
        resourceId: receipt.resourceId,
        resourceVersion: receipt.resourceVersion,
        evidenceRunSeq: receipt.issuedRunSeq,
        provenance:
          input.deliverySemantics === 'issued' ? 'issued' : 'acknowledged',
      }),
    );

  const seen = new Set<string>();
  return freezeArray(
    [...authored, ...received].filter((item) => {
      const key = `${item.resourceType}\u0000${item.resourceId}\u0000${item.resourceVersion}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}
