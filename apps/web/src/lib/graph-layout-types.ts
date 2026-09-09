export interface GraphLayoutInput {
  readonly mode?: 'network' | 'hierarchy';
  readonly direction?: 'LR' | 'TB';
  readonly nodes: readonly { readonly id: string }[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
  }[];
}
export interface GraphPosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export function validGraphPositions(
  value: unknown,
  input: GraphLayoutInput,
): value is GraphPosition[] {
  if (!Array.isArray(value) || value.length !== input.nodes.length)
    return false;
  const ids = new Set(input.nodes.map((node) => node.id));
  return value.every((node: unknown) => {
    if (
      typeof node !== 'object' ||
      node === null ||
      !('id' in node) ||
      typeof node.id !== 'string' ||
      !('x' in node) ||
      typeof node.x !== 'number' ||
      !Number.isFinite(node.x) ||
      !('y' in node) ||
      typeof node.y !== 'number' ||
      !Number.isFinite(node.y)
    )
      return false;
    return ids.delete(node.id);
  });
}
