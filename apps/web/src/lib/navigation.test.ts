import { describe, expect, it } from 'vitest';

import {
  activeSystemForPath,
  contextRoutesForPath,
  PRIMARY_SYSTEMS,
} from './navigation';

describe('WISER product navigation hierarchy', () => {
  it('orders peer systems by platform dependency and keeps the portal separate', () => {
    expect(PRIMARY_SYSTEMS.map((system) => system.id)).toEqual([
      'data-foundation',
      'agent-excon',
    ]);
    expect(activeSystemForPath('/zh-CN')).toBeNull();
    expect(activeSystemForPath('/zh-CN/login')).toBeNull();
    expect(activeSystemForPath('/zh-CN/data-foundation/catalog')).toBe(
      'data-foundation',
    );
    expect(activeSystemForPath('/zh-CN/runs')).toBe('agent-excon');
  });

  it('shows system tasks only after a user enters that system', () => {
    expect(contextRoutesForPath('/zh-CN')).toEqual([]);
    expect(contextRoutesForPath('/zh-CN/login')).toEqual([]);
    expect(
      contextRoutesForPath('/zh-CN/data-foundation').map((route) => route.key),
    ).toEqual([
      'overview',
      'catalog',
      'ingestions',
      'quality',
      'search',
      'knowledge',
      'graph',
      'geo',
      'map',
      'capabilities',
    ]);
    expect(
      contextRoutesForPath('/en/scenarios').map((route) => route.key),
    ).toEqual(['scenarios', 'runs']);
  });
});
