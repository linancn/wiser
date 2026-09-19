import {
  readBusinessPeriodUnit,
  writeBusinessPeriodUnit,
} from './business-period';
import { readSceneView, writeSceneView } from './business-scene-view';
import {
  readGraphLayoutSettings,
  writeGraphLayoutSettings,
} from './graph-layout-settings';
import { readBusinessReading } from './business-reading';
import { RelationEntitySchema } from '@wiser/data-contracts';
import { parseRelationNodeIdentity } from './relation-graph';
/** Retain diagram focus only within the same authorized query; it is not a data filter. */
export function withBusinessFocus(
  href: string,
  search: string,
  openedSaved?: { readonly viewId: string; readonly queryId: string },
): string {
  const url = new URL(href, 'http://local');
  const source = new URLSearchParams(search);
  const query = source.getAll('query');
  const saved = source.getAll('saved');
  const target = url.searchParams.get('query');
  const sameQuery = query.length === 1 && query[0] === target;
  const sameSaved =
    query.length === 0 &&
    saved.length === 1 &&
    openedSaved?.viewId === saved[0] &&
    openedSaved.queryId === target;
  if (!sameQuery && !sameSaved) return href;
  writeSceneView(url.searchParams, readSceneView(source));
  writeBusinessPeriodUnit(url.searchParams, readBusinessPeriodUnit(source));
  const edge = source.getAll('businessEdge');
  if (
    edge.length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      edge[0],
    )
  )
    url.searchParams.set('businessEdge', edge[0]);
  const reading = readBusinessReading(source);
  const presentations = source.getAll('businessPresentation');
  if (
    presentations.length === 1 &&
    ['reading', 'network'].includes(presentations[0])
  )
    url.searchParams.set('businessPresentation', reading.presentation);
  writeGraphLayoutSettings(url.searchParams, readGraphLayoutSettings(source));
  if (reading.page > 1)
    url.searchParams.set('businessPage', String(reading.page));
  const modes = source.getAll('businessMode');
  if (modes.length === 1 && modes[0] === 'all')
    url.searchParams.set('businessMode', 'all');
  const kinds = source.getAll('businessKind');
  if (
    kinds.length === 1 &&
    RelationEntitySchema.shape.kind.safeParse(kinds[0]).success
  )
    url.searchParams.set('businessKind', kinds[0]);
  const entities = source.getAll('businessEntity');
  if (entities.length === 1 && entities[0].length <= 2048) {
    try {
      parseRelationNodeIdentity(entities[0]);
      url.searchParams.set('businessEntity', entities[0]);
    } catch {
      /* Invalid focus must not change the authorized query. */
    }
  }
  return url.pathname + url.search;
}
