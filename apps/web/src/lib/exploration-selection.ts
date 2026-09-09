import type {
  ExplorationRecord,
  ExplorationGraphNode,
  ExplorationResource,
} from '@wiser/data-contracts';

export interface ExplorationSelection {
  readonly queryId: string | null;
  readonly resource: ExplorationResource | null;
  readonly record: ExplorationRecord | null;
  readonly node: ExplorationGraphNode | null;
}
export const emptyExplorationSelection: ExplorationSelection = {
  queryId: null,
  resource: null,
  record: null,
  node: null,
};
type Event =
  | { type: 'query'; queryId: string | null }
  | {
      type: 'node';
      queryId: string;
      node: ExplorationGraphNode;
      resource: ExplorationResource | null;
    }
  | { type: 'resource'; queryId: string; resource: ExplorationResource | null }
  | {
      type: 'record';
      queryId: string;
      record: ExplorationRecord;
      resource: ExplorationResource | null;
    };
export function explorationSelectionReducer(
  state: ExplorationSelection,
  event: Event,
): ExplorationSelection {
  if (event.type === 'query')
    return event.queryId === state.queryId
      ? state
      : { queryId: event.queryId, resource: null, record: null, node: null };
  if (event.queryId !== state.queryId) return state;
  if (event.type === 'resource')
    return { ...state, resource: event.resource, record: null, node: null };
  if (event.type === 'node') {
    const resource =
      event.resource?.versionId === event.node.versionId
        ? event.resource
        : state.resource?.versionId === event.node.versionId
          ? state.resource
          : null;
    return {
      ...state,
      resource,
      node: event.node,
      record: event.node.record ?? null,
    };
  }
  const resource =
    event.resource?.versionId === event.record.versionId
      ? event.resource
      : state.resource?.versionId === event.record.versionId
        ? state.resource
        : null;
  return { ...state, resource, record: event.record, node: null };
}
