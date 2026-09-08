import { describe, expect, it } from 'vitest';
import {
  explorationSelectionReducer,
  emptyExplorationSelection,
} from './exploration-selection';
import type {
  ExplorationRecord,
  ExplorationResource,
} from '@wiser/data-contracts';
const resource: ExplorationResource = {
  dataItemId: 'item',
  versionId: 'version',
  name: 'Station',
  provider: 'USGS',
  kind: 'DATASET_INTERFACE',
  assetCount: 1,
  readiness: { records: 'READY', spatial: 'READY', graph: 'READY' },
  recordCount: 1,
  featureCount: 1,
  limitations: [],
};
const record: ExplorationRecord = {
  recordId: 'record',
  featureId: 'record',
  dataItemId: 'item',
  versionId: 'version',
  analysisId: 'analysis',
  assetId: 'asset',
  sourceId: '01646500',
  index: 1,
  values: { station: '01646500' },
};
describe('shared exploration selection', () => {
  it('links graph record identities to the same record and rejects stale graph selections', () => {
    const state = explorationSelectionReducer(emptyExplorationSelection, {
      type: 'query',
      queryId: 'one',
    });
    const node = {
      id: 'record:analysis:record',
      kind: 'RECORD' as const,
      label: 'Station',
      dataItemId: 'item',
      versionId: 'version',
      record,
    };
    const selected = explorationSelectionReducer(state, {
      type: 'node',
      queryId: 'one',
      node,
      resource,
    });
    expect(selected.record).toBe(record);
    expect(selected.node).toBe(node);
    expect(
      explorationSelectionReducer(selected, {
        type: 'node',
        queryId: 'old',
        node,
        resource,
      }),
    ).toBe(selected);
    expect(
      explorationSelectionReducer(selected, { type: 'query', queryId: 'two' }),
    ).toMatchObject({ record: null, node: null, resource: null });
  });
  it('links resource and record selections and rejects events from a stale query', () => {
    let state = explorationSelectionReducer(emptyExplorationSelection, {
      type: 'query',
      queryId: 'one',
    });
    state = explorationSelectionReducer(state, {
      type: 'resource',
      queryId: 'one',
      resource,
    });
    state = explorationSelectionReducer(state, {
      type: 'record',
      queryId: 'one',
      record,
      resource,
    });
    expect(state).toMatchObject({
      resource: { versionId: 'version' },
      record: { recordId: 'record' },
    });
    expect(
      explorationSelectionReducer(state, {
        type: 'resource',
        queryId: 'old',
        resource: null,
      }),
    ).toBe(state);
    state = explorationSelectionReducer(state, {
      type: 'query',
      queryId: 'two',
    });
    expect(state).toEqual({ queryId: 'two', resource: null, record: null });
    expect(
      explorationSelectionReducer(state, {
        type: 'record',
        queryId: 'one',
        record,
        resource,
      }),
    ).toBe(state);
  });
  it('clears a record when selecting a different version', () => {
    const selected = { queryId: 'one', resource, record };
    expect(
      explorationSelectionReducer(selected, {
        type: 'resource',
        queryId: 'one',
        resource: { ...resource, versionId: 'new' },
      }).record,
    ).toBeNull();
  });
});
