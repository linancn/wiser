import { z } from 'zod';
import {
  ExplorationQueryInputV110Schema,
  ExplorationResultV110Schema,
  ExplorationGraphSchema as PreviousGraph,
} from './v110.ts';
export * from './v110.ts';
export const ExplorationGraphRelationSchema = z.enum([
  'HAS_VERSION',
  'HAS_ASSET',
  'HAS_EVIDENCE',
  'HAS_RECORD',
]);
export const ExplorationGraphOptionsSchema = z.strictObject({
  detail: z.enum(['assets', 'evidence', 'records']).optional(),
  relations: z
    .array(ExplorationGraphRelationSchema)
    .max(4)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
  path: z
    .strictObject({
      from: z.string().min(1).max(256),
      to: z.string().min(1).max(256),
      maxDepth: z.number().int().min(1).max(8).default(8),
    })
    .optional(),
});
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV110Schema.shape,
    graph: ExplorationGraphOptionsSchema.optional(),
  })
  .superRefine((input, context) => {
    const { graph, ...previous } = input;
    const checked = ExplorationQueryInputV110Schema.safeParse(previous);
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (
      graph &&
      (input.view !== 'graph' ||
        (graph.detail && (!input.versionId || input.recordId)) ||
        (graph.detail === 'records' && !input.assetId))
    )
      context.addIssue({
        code: 'custom',
        path: ['graph'],
        message:
          'Graph neighbor queries require an unambiguous version and asset focus',
      });
  });
export const ExplorationGraphSchema = PreviousGraph.safeExtend({
  grain: z.enum(['versions', 'assets', 'evidence', 'records']).optional(),
  path: z
    .strictObject({
      found: z.boolean(),
      nodeIds: z.array(z.string()).max(9),
      edgeIds: z.array(z.string()).max(8),
    })
    .optional(),
}).superRefine((graph, context) => {
  const path = graph.path;
  if (!path) return;
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  if (
    path.found
      ? path.nodeIds.length !== path.edgeIds.length + 1 ||
        path.nodeIds.some((id) => !nodes.has(id)) ||
        path.edgeIds.some((id, index) => {
          const edge = edges.get(id);
          return (
            !edge ||
            edge.source !== path.nodeIds[index] ||
            edge.target !== path.nodeIds[index + 1]
          );
        })
      : path.nodeIds.length > 0 || path.edgeIds.length > 0
  )
    context.addIssue({
      code: 'custom',
      path: ['path'],
      message: 'Path must be a directed subset of this page',
    });
});
export const ExplorationResultSchema = z
  .strictObject({
    ...ExplorationResultV110Schema.shape,
    graph: ExplorationGraphSchema.optional(),
  })
  .superRefine((result, context) => {
    const { graph, ...previous } = result;
    const checked = ExplorationResultV110Schema.safeParse({
      ...previous,
      ...(graph
        ? {
            graph: {
              nodes: graph.nodes,
              edges: graph.edges,
              truncated: graph.truncated,
            },
          }
        : {}),
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
export type ExplorationGraph = z.infer<typeof ExplorationGraphSchema>;
export type ExplorationGraphOptions = z.infer<
  typeof ExplorationGraphOptionsSchema
>;
export type ExplorationGraphRelation = z.infer<
  typeof ExplorationGraphRelationSchema
>;
