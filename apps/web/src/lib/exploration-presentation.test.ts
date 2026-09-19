import { expect, it } from 'vitest';
import {
  capturePresentation,
  restorePresentation,
} from './exploration-presentation';
const viewId = '10000000-0000-4000-8000-000000000001';
it('captures the real reading controls and restores a named scene without changing its query', () => {
  const selected = JSON.stringify([viewId, viewId, 'v1', 'river']);
  const source = new URLSearchParams({
    businessForm: 'space',
    businessStyle: 'evidence',
    businessMapLon: '115.7',
    businessMapLat: '40.2',
    businessPeriodUnit: 'year',
    businessEntity: selected,
    businessPresentation: 'reading',
    businessPage: '3',
  });
  const saved = capturePresentation(source);
  expect(saved).toMatchObject({
    scene: { form: 'space', style: 'evidence', mapLon: 115.7 },
    periodUnit: 'year',
    reading: { presentation: 'reading', page: 3 },
    focus: { entity: { entityKey: 'river' } },
  });
  const params = new URLSearchParams({ saved: viewId, view: 'graph' });
  const restored = restorePresentation(params, viewId, saved);
  expect(restored.get('saved')).toBe(viewId);
  expect(restored.has('query')).toBe(false);
  expect(capturePresentation(restored)).toEqual(saved);
  expect(params.has('businessForm')).toBe(false);
  // An intentional reset to defaults must survive refresh, rather than restore the saved non-default again.
  restored.delete('businessForm');
  expect(
    capturePresentation(restorePresentation(restored, viewId, saved))?.scene
      .form,
  ).toBe('flat');
});
it('keeps explicit link overrides and rejects cross-topic restoration and arbitrary controls', () => {
  const saved = capturePresentation(new URLSearchParams('businessForm=layers'));
  const explicit = new URLSearchParams({
    saved: viewId,
    businessForm: 'flat',
    businessEdge: viewId,
  });
  expect(restorePresentation(explicit, viewId, saved).get('businessForm')).toBe(
    'flat',
  );
  expect(restorePresentation(explicit, viewId, saved).get('businessEdge')).toBe(
    viewId,
  );
  const other = new URLSearchParams('saved=another&query=another');
  expect(restorePresentation(other, viewId, saved).toString()).toBe(
    other.toString(),
  );
  const bad = capturePresentation(
    new URLSearchParams(
      'businessEntity=script&businessEdge=bad&businessKind=bad&businessZoom=Infinity&token=private',
    ),
  );
  expect(bad.focus).toBeUndefined();
  expect(bad.scene.zoom).toBe(1);
  expect(JSON.stringify(bad)).not.toContain('private');
});
