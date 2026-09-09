import {
  ExplorationViewSpecSchema,
  ExplorationViewRequestSchema,
  type ExplorationViewSpec,
  type ExplorationViewRequest,
  type ExplorationMapView,
} from '@wiser/data-contracts';
import type { ExplorationView } from './exploration-navigation';
export type ViewNavigation = NonNullable<
  ExplorationViewSpec['navigation']
>['resources'];
export function createExplorationViewState(
  queryId: string,
  seed?: ExplorationViewSpec,
) {
  const valid =
    seed &&
    Object.values(seed.requests).every(
      (request) => !request || request.queryId === queryId,
    );
  const state: ExplorationViewSpec = valid
    ? structuredClone(seed)
    : { activeView: 'resources', requests: {} };
  return {
    get initial() {
      return state;
    },
    report(
      view: ExplorationView,
      request: ExplorationViewRequest | null,
      navigation?: ViewNavigation,
    ) {
      if (request === null) {
        delete state.requests[view];
        return;
      }
      const checked = ExplorationViewRequestSchema.safeParse(request);
      if (!checked.success || checked.data.queryId !== queryId) return;
      state.requests[view] = checked.data;
      if (
        navigation &&
        (view === 'resources' || view === 'records' || view === 'graph')
      ) {
        state.navigation ??= {};
        state.navigation[view] = structuredClone(navigation);
      }
    },
    reportMap(map: ExplorationMapView) {
      state.map = structuredClone(map);
    },
    capture(
      activeView: ExplorationView,
      selection?: ExplorationViewSpec['selection'],
    ) {
      const checked = ExplorationViewSpecSchema.safeParse({
        ...state,
        activeView,
        selection,
      });
      return checked.success ? checked.data : null;
    },
  };
}
export type ExplorationViewState = ReturnType<
  typeof createExplorationViewState
>;
