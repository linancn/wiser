import { describe, expect, it } from 'vitest';

import { type DomainError, prepareRunEventAppendBatch } from '../src/index.js';

const testHash = (canonical: string) => `test-hash:${canonical}`;

describe('short serialized RunEvent append request', () => {
  it('copies event payloads so caller mutation cannot rewrite a prepared append', () => {
    const payload = { claimEpoch: 1, nested: { taskId: 'task-evidence' } };
    const request = prepareRunEventAppendBatch({
      head: {
        runId: 'run-yongding-001',
        nextRunSeq: 1,
        headHash: 'genesis',
      },
      drafts: [
        {
          eventId: 'event-task-claimed',
          streamType: 'run_task',
          streamId: 'task-evidence',
          eventType: 'task.claimed',
          actorType: 'run_agent',
          actorId: 'agent-a',
          virtualTime: '2023-03-22T07:00:00.000Z',
          occurredAt: '2023-03-22T07:00:01.000Z',
          recordedAt: '2023-03-22T07:00:01.100Z',
          schemaVersion: 1,
          assertionClass: 'platform_observed',
          payload,
        },
      ],
      hashCanonical: testHash,
    });

    payload.claimEpoch = 99;
    payload.nested.taskId = 'rewritten';

    expect(request.events[0]?.payload).toEqual({
      claimEpoch: 1,
      nested: { taskId: 'task-evidence' },
    });
  });

  it('assigns a contiguous sequence and hash chain behind one explicit head precondition', () => {
    const head = {
      runId: 'run-yongding-001',
      nextRunSeq: 41,
      headHash: 'test-hash:event-40',
    } as const;
    const request = prepareRunEventAppendBatch({
      head,
      drafts: [
        {
          eventId: 'event-task-claimed',
          streamType: 'run_task',
          streamId: 'task-evidence',
          eventType: 'task.claimed',
          actorType: 'run_agent',
          actorId: 'agent-a',
          virtualTime: '2023-03-22T07:00:00.000Z',
          occurredAt: '2023-03-22T07:00:01.000Z',
          recordedAt: '2023-03-22T07:00:01.100Z',
          schemaVersion: 1,
          assertionClass: 'platform_observed',
          payload: { claimEpoch: 1, taskId: 'task-evidence' },
        },
        {
          eventId: 'event-task-started',
          streamType: 'run_task',
          streamId: 'task-evidence',
          eventType: 'task.started',
          actorType: 'run_agent',
          actorId: 'agent-a',
          virtualTime: '2023-03-22T07:00:00.000Z',
          occurredAt: '2023-03-22T07:00:02.000Z',
          recordedAt: '2023-03-22T07:00:02.100Z',
          schemaVersion: 1,
          assertionClass: 'platform_observed',
          payload: { claimEpoch: 1, taskId: 'task-evidence' },
        },
      ],
      hashCanonical: testHash,
    });

    expect(request.headPrecondition).toEqual(head);
    expect(request.events.map(({ runSeq }) => runSeq)).toEqual([41, 42]);
    expect(request.events[0]?.previousHash).toBe(head.headHash);
    expect(request.events[1]?.previousHash).toBe(request.events[0]?.eventHash);
    expect(request.nextHead).toEqual({
      runId: head.runId,
      nextRunSeq: 43,
      headHash: request.events[1]?.eventHash,
    });
    expect(head).toEqual({
      runId: 'run-yongding-001',
      nextRunSeq: 41,
      headHash: 'test-hash:event-40',
    });
  });

  it('rejects empty batches and duplicate event identities before asking infra to lock the head', () => {
    const head = {
      runId: 'run-yongding-001',
      nextRunSeq: 1,
      headHash: 'genesis',
    } as const;
    const draft = {
      eventId: 'event-1',
      streamType: 'run',
      streamId: 'run-yongding-001',
      eventType: 'run.formed',
      actorType: 'human_member',
      actorId: 'operator-1',
      virtualTime: '2023-03-22T07:00:00.000Z',
      occurredAt: '2023-03-22T07:00:01.000Z',
      recordedAt: '2023-03-22T07:00:01.100Z',
      schemaVersion: 1,
      assertionClass: 'operator_asserted' as const,
      payload: {},
    };

    expect(() =>
      prepareRunEventAppendBatch({ head, drafts: [], hashCanonical: testHash }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'EMPTY_EVENT_BATCH',
      }),
    );
    expect(() =>
      prepareRunEventAppendBatch({
        head,
        drafts: [draft, draft],
        hashCanonical: testHash,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'DUPLICATE_EVENT_ID',
      }),
    );
  });
});
