import type { Feature, FeatureCollection } from 'geojson';
import type { BusinessScene } from './business-scene';
import { businessMapBounds } from './business-map';

/** Screen-space reading layout only; these positions are never geographic coordinates. */
export function unlocatedSceneLayout(
  nodes: BusinessScene['nodes'],
  width: number,
  height: number,
) {
  const groups = new Map<string, BusinessScene['nodes']>();
  for (const node of nodes) {
    const members = groups.get(node.group) ?? [];
    members.push(node);
    groups.set(node.group, members);
  }
  const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'));
  const columns = Math.max(1, Math.floor(width / 8));
  const rows = ordered.reduce(
    (sum, [, members]) => sum + Math.ceil(members.length / columns),
    0,
  );
  const header = Math.min(22, height / Math.max(1, ordered.length) / 2);
  const dx = width / columns;
  const dy = Math.min(
    12,
    (height - header * ordered.length) / Math.max(1, rows),
  );
  const positions = new Map<string, [number, number]>();
  const captions: { group: string; y: number; count: number }[] = [];
  let top = 0;
  for (const [group, members] of ordered) {
    captions.push({ group, y: top + header * 0.7, count: members.length });
    top += header;
    [...members]
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))
      .forEach((node, index) => {
        positions.set(node.id, [
          ((index % columns) + 0.5) * dx,
          top + (Math.floor(index / columns) + 0.5) * dy,
        ]);
      });
    top += Math.ceil(members.length / columns) * dy;
  }
  return {
    positions,
    captions,
    radius: Math.max(0.4, Math.min(3, (Math.min(dx, dy) - 1) / 2)),
  };
}
export type SpatialSceneAnchor = {
  feature: Feature;
  labelPoint: [number, number];
};
/** The center is a connector label position for the original geometry, not a new point feature. */
export function spatialSceneAnchors(
  scene: BusinessScene,
  collection: FeatureCollection,
) {
  const features = new Map(
    collection.features.map((f) => [
      JSON.stringify([
        f.properties?.['dataItemId'],
        f.properties?.['versionId'],
        f.properties?.['recordId'],
      ]),
      f,
    ]),
  );
  const anchors = new Map<string, SpatialSceneAnchor>();
  for (const node of scene.nodes) {
    if (!node.record) continue;
    const f = features.get(
      JSON.stringify([
        node.record.dataItemId,
        node.record.versionId,
        node.record.recordId,
      ]),
    );
    if (!f) continue;
    const bounds = businessMapBounds({
      type: 'FeatureCollection',
      features: [f],
    });
    if (!bounds) continue;
    anchors.set(node.id, {
      feature: f,
      labelPoint: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    });
  }
  return anchors;
}
