import { describe, expect, it } from 'vitest';

import { getReferenceInteractions } from './platform';
import {
  collaborationSummary,
  deliveryStateLabel,
  interactionNeedsAttention,
} from './run-collaboration';

describe('Run collaboration projection', () => {
  it('summarizes the reference Run from causal exchanges, not telemetry', () => {
    const interactions = getReferenceInteractions('run-yongding-spring-042');

    expect(interactions).toHaveLength(7);
    expect(collaborationSummary(interactions)).toEqual({
      acknowledgedDeliveries: 9,
      handoffCount: 3,
      openRequestCount: 0,
      requestCount: 1,
      responseCount: 3,
      totalDeliveries: 9,
    });
  });

  it('never presents a Receipt acknowledgement as human reading', () => {
    expect(deliveryStateLabel('pending_sync', 'zh-CN')).toBe('待收取');
    expect(deliveryStateLabel('issued', 'zh-CN')).toBe('已签发可见性收据');
    expect(deliveryStateLabel('acknowledged', 'zh-CN')).toBe('接收批次已确认');
    expect(deliveryStateLabel('acknowledged', 'zh-CN')).not.toContain('已读');
  });

  it('counts only fully acknowledged handoffs and fully answered requests as closed', () => {
    const interactions = getReferenceInteractions('run-yongding-spring-042');
    const partial = interactions.map((exchange, index) => {
      if (index === 0) {
        return {
          ...exchange,
          deliveries: exchange.deliveries.map((delivery) => ({
            ...delivery,
            state: 'issued' as const,
          })),
          status: 'open' as const,
        };
      }
      if (exchange.kind === 'request') {
        return {
          ...exchange,
          responseMessageIds: exchange.responseMessageIds.slice(0, 2),
          status: 'open' as const,
        };
      }
      return exchange;
    });

    expect(collaborationSummary(partial)).toMatchObject({
      acknowledgedDeliveries: 8,
      handoffCount: 2,
      openRequestCount: 1,
    });
    expect(interactionNeedsAttention(partial[0]!)).toBe(true);
    expect(
      interactionNeedsAttention(
        partial.find(({ kind }) => kind === 'request')!,
      ),
    ).toBe(true);
  });
});
