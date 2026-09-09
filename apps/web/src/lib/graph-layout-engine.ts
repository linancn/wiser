import { DagreLayout, ForceAtlas2Layout } from '@antv/layout';
import {
  validGraphPositions,
  type GraphLayoutInput,
  type GraphPosition,
} from './graph-layout-types';

export async function computeGraphLayout(
  input: GraphLayoutInput,
): Promise<GraphPosition[]> {
  const ids = new Set(input.nodes.map((node) => node.id));
  if (
    input.nodes.length > 5000 ||
    input.edges.length > 10000 ||
    ids.size !== input.nodes.length ||
    input.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
  )
    throw new Error('Invalid bounded graph');
  if (input.nodes.length === 0) return [];
  if (input.mode === 'network') return networkLayout(input);
  return layoutOne(input);
}

async function layoutOne(input: GraphLayoutInput): Promise<GraphPosition[]> {
  if (input.nodes.length === 1) return [{ id: input.nodes[0].id, x: 0, y: 0 }];
  const layout =
    input.mode === 'network'
      ? new ForceAtlas2Layout({
          width: 1200,
          height: 800,
          maxIteration: 160,
          preventOverlap: true,
          nodeSize: 70,
          kr: 30,
          kg: 2,
          barnesHut: true,
          prune: false,
          enableWorker: false,
        })
      : new DagreLayout({
          rankdir: input.direction ?? 'LR',
          nodesep: input.direction === 'TB' ? 180 : 40,
          ranksep: input.direction === 'TB' ? 80 : 120,
          nodeSize: 24,
          enableWorker: false,
        });
  try {
    const columns = Math.ceil(Math.sqrt(input.nodes.length));
    await layout.execute({
      nodes: input.nodes.map((node, index) => ({
        ...node,
        x: (index % columns) * 100,
        y: Math.floor(index / columns) * 100,
      })),
      edges: [...input.edges],
    });
    const positions: GraphPosition[] = [];
    layout.forEachNode((node) => {
      positions.push({ id: String(node.id), x: node.x, y: node.y });
    });
    if (!validGraphPositions(positions, input))
      throw new Error('Invalid layout result');
    return positions;
  } finally {
    layout.destroy();
  }
}

// Pack independent neighborhoods so unrelated sources do not cross one another.
async function networkLayout(
  input: GraphLayoutInput,
): Promise<GraphPosition[]> {
  const neighbors = new Map(
    input.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of input.edges) {
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const groups: string[][] = [];
  const groupOf = new Map<string, number>();
  for (const node of input.nodes) {
    if (groupOf.has(node.id)) continue;
    const group = [node.id];
    groupOf.set(node.id, groups.length);
    for (let index = 0; index < group.length; index++) {
      for (const neighbor of neighbors.get(group[index])!) {
        if (groupOf.has(neighbor)) continue;
        groupOf.set(neighbor, groups.length);
        group.push(neighbor);
      }
    }
    groups.push(group);
  }
  const edgeGroups = groups.map(
    () => [] as GraphLayoutInput['edges'][number][],
  );
  for (const edge of input.edges)
    edgeGroups[groupOf.get(edge.source)!].push(edge);
  const boxes = [];
  for (let i = 0; i < groups.length; i++) {
    const positions = await layoutOne({
      mode: 'network',
      nodes: groups[i].map((id) => ({ id })),
      edges: edgeGroups[i],
    });
    const left = Math.min(...positions.map((p) => p.x)),
      top = Math.min(...positions.map((p) => p.y));
    const width = Math.max(
      260,
      Math.max(...positions.map((p) => p.x)) - left + 220,
    );
    const height = Math.max(
      180,
      Math.max(...positions.map((p) => p.y)) - top + 140,
    );
    boxes.push({ positions, left, top, width, height });
  }
  const targetWidth = Math.max(
    ...boxes.map((b) => b.width),
    Math.sqrt(boxes.reduce((sum, b) => sum + b.width * b.height, 0)) * 1.3,
  );
  let x = 0,
    y = 0,
    rowHeight = 0;
  const result: GraphPosition[] = [];
  for (const box of boxes) {
    if (x > 0 && x + box.width > targetWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    for (const point of box.positions)
      result.push({
        id: point.id,
        x: point.x - box.left + x + 110,
        y: point.y - box.top + y + 70,
      });
    x += box.width;
    rowHeight = Math.max(rowHeight, box.height);
  }
  const order = new Map(input.nodes.map((node, index) => [node.id, index]));
  return result.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
