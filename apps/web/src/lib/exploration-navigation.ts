import type { Locale } from './i18n';

export const explorationViews = [
  'resources',
  'records',
  'map',
  'graph',
  'statistics',
] as const;
export type ExplorationView = (typeof explorationViews)[number];

export function explorationView(value: unknown): ExplorationView {
  return explorationViews.find((view) => view === value) ?? 'resources';
}

export function explorationHref(
  locale: Locale,
  queryId: string,
  view: ExplorationView,
) {
  const parameters = new URLSearchParams({ query: queryId });
  if (view !== 'resources') parameters.set('view', view);
  return `/${locale}/data-foundation/explore?${parameters}`;
}
