import {
  ExplorationPresentationSchema,
  type ExplorationPresentation,
} from '@wiser/data-contracts';
import { readSceneView, writeSceneView } from './business-scene-view';
import {
  readGraphLayoutSettings,
  writeGraphLayoutSettings,
} from './graph-layout-settings';
import {
  readBusinessPeriodUnit,
  writeBusinessPeriodUnit,
} from './business-period';
import { readBusinessReading } from './business-reading';
import { parseRelationNodeIdentity } from './relation-graph';
const restoredKey = 'businessSavedPresentation';
/** Whitelisted display controls; never capture arbitrary URL fields or business query filters. */
export function capturePresentation(
  params: URLSearchParams,
): ExplorationPresentation {
  const single = (key: string) => {
    const values = params.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  };
  const focus: NonNullable<ExplorationPresentation['focus']> = {};
  const schema = ExplorationPresentationSchema.shape.focus.unwrap().shape;
  const edge = schema.edge.safeParse(single('businessEdge'));
  const kind = schema.kind.safeParse(single('businessKind'));
  if (edge.success && edge.data) focus.edge = edge.data;
  if (kind.success && kind.data) focus.kind = kind.data;
  const entity = single('businessEntity');
  if (entity && entity.length <= 2048)
    try {
      focus.entity = parseRelationNodeIdentity(entity);
    } catch {
      /* Ignore malformed display selection. */
    }
  return ExplorationPresentationSchema.parse({
    scene: readSceneView(params),
    layout: readGraphLayoutSettings(params),
    reading: {
      ...readBusinessReading(params),
      mode: single('businessMode') === 'all' ? 'all' : 'overview',
    },
    periodUnit: readBusinessPeriodUnit(params),
    ...(Object.keys(focus).length ? { focus } : {}),
  });
}
/** Restore once per saved link. The marker preserves deliberate resets to defaults on reload. */
export function restorePresentation(
  params: URLSearchParams,
  viewId: string,
  presentation: ExplorationPresentation,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (
    params.getAll('saved').length !== 1 ||
    params.get('saved') !== viewId ||
    params.has('query') ||
    (params.getAll(restoredKey).length === 1 &&
      params.get(restoredKey) === viewId)
  )
    return next;
  const checked = ExplorationPresentationSchema.safeParse(presentation);
  if (!checked.success) return next;
  const p = checked.data,
    seed = new URLSearchParams();
  writeSceneView(seed, p.scene);
  writeGraphLayoutSettings(seed, p.layout);
  writeBusinessPeriodUnit(seed, p.periodUnit);
  seed.set('businessPresentation', p.reading.presentation);
  seed.set('businessPage', String(p.reading.page));
  seed.set('businessMode', p.reading.mode);
  const explicitFocus = ['businessEntity', 'businessEdge', 'businessKind'].some(
    (k) => params.has(k),
  );
  if (!explicitFocus) {
    if (p.focus?.edge) seed.set('businessEdge', p.focus.edge);
    if (p.focus?.kind) seed.set('businessKind', p.focus.kind);
    if (p.focus?.entity) {
      const e = p.focus.entity;
      seed.set(
        'businessEntity',
        JSON.stringify([
          e.dataItemId,
          e.versionId,
          e.mappingVersion,
          e.entityKey,
        ]),
      );
    }
  }
  for (const [key, value] of seed) if (!next.has(key)) next.set(key, value);
  next.set(restoredKey, viewId);
  return next;
}
