import { fail } from './shared.js';

export type AgentInteractionKind =
  'inform' | 'request' | 'response' | 'handoff';

export interface AgentInteractionMessage {
  readonly id: string;
  readonly threadId: string;
  readonly kind: AgentInteractionKind;
  readonly replyToMessageId?: string;
  readonly senderRunAgentId: string;
  readonly recipientRunAgentIds: readonly string[];
}

export function createAgentInteraction(input: {
  readonly id: string;
  readonly kind: AgentInteractionKind;
  readonly senderRunAgentId: string;
  readonly recipientRunAgentIds: readonly string[];
  readonly replyToMessageId?: string;
  readonly parentMessage?: AgentInteractionMessage;
  readonly parentIssuedToSender?: boolean;
}): AgentInteractionMessage {
  if (
    input.recipientRunAgentIds.length === 0 ||
    new Set(input.recipientRunAgentIds).size !==
      input.recipientRunAgentIds.length ||
    input.recipientRunAgentIds.includes(input.senderRunAgentId)
  ) {
    fail(
      'MESSAGE_RECIPIENT_CONFLICT',
      'Agent messages require a non-empty, distinct recipient snapshot that excludes the sender.',
    );
  }

  if (input.kind !== 'response') {
    if (
      input.replyToMessageId !== undefined ||
      input.parentMessage !== undefined
    ) {
      fail(
        'MESSAGE_REPLY_CONFLICT',
        'Only a response may reference a parent request.',
      );
    }
    return Object.freeze({
      id: input.id,
      threadId: input.id,
      kind: input.kind,
      senderRunAgentId: input.senderRunAgentId,
      recipientRunAgentIds: Object.freeze([...input.recipientRunAgentIds]),
    });
  }

  const parent = input.parentMessage;
  if (
    input.replyToMessageId === undefined ||
    parent === undefined ||
    parent.id !== input.replyToMessageId ||
    parent.kind !== 'request'
  ) {
    fail(
      'MESSAGE_REPLY_CONFLICT',
      'A response must reference an existing request as its direct parent.',
    );
  }
  if (
    !parent.recipientRunAgentIds.includes(input.senderRunAgentId) ||
    input.parentIssuedToSender !== true
  ) {
    fail(
      'RESOURCE_NOT_ISSUED',
      'The responding RunAgent must first receive the parent request through its own Receipt chain.',
    );
  }
  if (!input.recipientRunAgentIds.includes(parent.senderRunAgentId)) {
    fail(
      'MESSAGE_RECIPIENT_CONFLICT',
      'A response recipient snapshot must include the parent request sender.',
    );
  }

  return Object.freeze({
    id: input.id,
    threadId: parent.threadId,
    kind: 'response',
    replyToMessageId: parent.id,
    senderRunAgentId: input.senderRunAgentId,
    recipientRunAgentIds: Object.freeze([...input.recipientRunAgentIds]),
  });
}
