import { DagreLayout } from '@antv/layout';
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
  const layout = new DagreLayout({
    rankdir: 'LR',
    nodesep: 40,
    ranksep: 120,
    nodeSize: 24,
    enableWorker: false,
  });
  try {
    await layout.execute({ nodes: [...input.nodes], edges: [...input.edges] });
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
