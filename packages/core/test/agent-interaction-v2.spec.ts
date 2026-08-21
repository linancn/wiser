import { describe, expect, it } from 'vitest';

import {
  DomainError,
  createAgentInteraction,
  type AgentInteractionMessage,
} from '../src/index.js';

const request: AgentInteractionMessage = {
  id: '00000000-0000-4000-8000-000000000101',
  threadId: '00000000-0000-4000-8000-000000000101',
  kind: 'request',
  senderRunAgentId: '00000000-0000-4000-8000-000000000001',
  recipientRunAgentIds: [
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ],
};

describe('v2 agent interaction threads', () => {
  it('creates a root request whose message id is the immutable thread id', () => {
    expect(
      createAgentInteraction({
        id: request.id,
        kind: request.kind,
        senderRunAgentId: request.senderRunAgentId,
        recipientRunAgentIds: request.recipientRunAgentIds,
      }),
    ).toEqual(request);
  });

  it('allows only a receipted request recipient to post a causal response', () => {
    const response = createAgentInteraction({
      id: '00000000-0000-4000-8000-000000000102',
      kind: 'response',
      senderRunAgentId: '00000000-0000-4000-8000-000000000002',
      recipientRunAgentIds: ['00000000-0000-4000-8000-000000000001'],
      replyToMessageId: request.id,
      parentMessage: request,
      parentIssuedToSender: true,
    });

    expect(response).toEqual({
      id: '00000000-0000-4000-8000-000000000102',
      threadId: request.threadId,
      kind: 'response',
      replyToMessageId: request.id,
      senderRunAgentId: '00000000-0000-4000-8000-000000000002',
      recipientRunAgentIds: ['00000000-0000-4000-8000-000000000001'],
    });

    expect(() =>
      createAgentInteraction({
        id: '00000000-0000-4000-8000-000000000103',
        kind: 'response',
        senderRunAgentId: '00000000-0000-4000-8000-000000000003',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000001'],
        replyToMessageId: request.id,
        parentMessage: request,
        parentIssuedToSender: false,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'RESOURCE_NOT_ISSUED',
      }),
    );
  });

  it('rejects orphan responses and self-only communication', () => {
    expect(() =>
      createAgentInteraction({
        id: '00000000-0000-4000-8000-000000000104',
        kind: 'response',
        senderRunAgentId: '00000000-0000-4000-8000-000000000002',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'MESSAGE_REPLY_CONFLICT',
      }),
    );

    expect(() =>
      createAgentInteraction({
        id: '00000000-0000-4000-8000-000000000105',
        kind: 'inform',
        senderRunAgentId: '00000000-0000-4000-8000-000000000002',
        recipientRunAgentIds: ['00000000-0000-4000-8000-000000000002'],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'MESSAGE_RECIPIENT_CONFLICT',
      }),
    );
  });
});
