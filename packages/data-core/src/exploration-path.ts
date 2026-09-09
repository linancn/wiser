/** Directed shortest path within a caller-authorized, bounded graph. */
export function findExplorationPath(
  graph: {
    readonly nodes: readonly { readonly id: string }[];
    readonly edges: readonly {
      readonly id: string;
      readonly source: string;
      readonly target: string;
    }[];
  },
  request: {
    readonly from: string;
    readonly to: string;
    readonly maxDepth: number;
  },
): { found: boolean; nodeIds: string[]; edgeIds: string[] } {
  const absent = { found: false, nodeIds: [], edgeIds: [] };
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(request.from) || !ids.has(request.to)) return absent;
  const adjacent = new Map<string, { id: string; target: string }[]>();
  for (const edge of graph.edges)
    if (ids.has(edge.source) && ids.has(edge.target)) {
      const list = adjacent.get(edge.source) ?? [];
      list.push(edge);
      adjacent.set(edge.source, list);
    }
  for (const list of adjacent.values())
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const queue = [
    { id: request.from, nodeIds: [request.from], edgeIds: [] as string[] },
  ];
  const visited = new Set([request.from]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if (current.id === request.to)
      return {
        found: true,
        nodeIds: current.nodeIds,
        edgeIds: current.edgeIds,
      };
    if (current.edgeIds.length >= request.maxDepth) continue;
    for (const edge of adjacent.get(current.id) ?? [])
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({
          id: edge.target,
          nodeIds: [...current.nodeIds, edge.target],
          edgeIds: [...current.edgeIds, edge.id],
        });
      }
  }
  return absent;
}
