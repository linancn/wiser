import { z } from 'zod';
import {
  ExplorationQueryInputV111Schema,
  ExplorationResultV111Schema,
  ExplorationResourceSchema,
  ExplorationRecordSchema,
  ExplorationGraphNodeSchema,
} from './v111.ts';
export const ExplorationViewNameSchema = z.enum([
  'resources',
  'records',
  'map',
  'graph',
  'statistics',
]);
const {
  spec: _spec,
  baseQueryId: _base,
  ...requestShape
} = ExplorationQueryInputV111Schema.shape;
export const ExplorationViewRequestSchema = z
  .strictObject({ ...requestShape, queryId: z.uuid() })
  .superRefine((value, context) => {
    const checked = ExplorationQueryInputV111Schema.safeParse(value);
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
const requests = z.strictObject({
  resources: ExplorationViewRequestSchema.refine(
    (value) => value.view === 'resources',
  ).optional(),
  records: ExplorationViewRequestSchema.refine(
    (value) => value.view === 'records',
  ).optional(),
  map: ExplorationViewRequestSchema.refine(
    (value) => value.view === 'map',
  ).optional(),
  graph: ExplorationViewRequestSchema.refine(
    (value) => value.view === 'graph',
  ).optional(),
  statistics: ExplorationViewRequestSchema.refine(
    (value) => value.view === 'aggregate' || value.view === 'resources',
  ).optional(),
});
const navigation = z
  .strictObject({
    page: z.number().int().min(0).max(255),
    cursors: z.array(z.string().min(1).max(8192).nullable()).min(1).max(256),
  })
  .refine((value) => value.page < value.cursors.length);
export const ExplorationMapViewSchema = z.strictObject({
  camera: z
    .strictObject({
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-85.051129).max(85.051129),
      zoom: z.number().min(0).max(24),
      bearing: z.number().min(-180).max(180),
      pitch: z.number().min(0).max(85),
    })
    .optional(),
  layers: z
    .strictObject({
      points: z.boolean(),
      lines: z.boolean(),
      polygons: z.boolean(),
    })
    .optional(),
});
export const ExplorationViewSpecSchema = z
  .strictObject({
    activeView: ExplorationViewNameSchema,
    requests,
    navigation: z
      .strictObject({
        resources: navigation.optional(),
        records: navigation.optional(),
        graph: navigation.optional(),
      })
      .optional(),
    map: ExplorationMapViewSchema.optional(),
    selection: z
      .strictObject({
        dataItemId: z.uuid(),
        versionId: z.uuid(),
        recordId: z.uuid().optional(),
        nodeId: z.string().min(1).max(256).optional(),
        assetId: z.uuid().optional(),
      })
      .optional(),
  })
  .refine(
    (value) => value.requests[value.activeView] !== undefined,
    'The active view requires a request',
  );
export const CreateExplorationViewInputSchema = z
  .strictObject({
    queryId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    visibility: z.enum(['private', 'project']).default('private'),
    viewSpec: ExplorationViewSpecSchema,
  })
  .refine(
    (value) =>
      Object.values(value.viewSpec.requests).every(
        (request) => request === undefined || request.queryId === value.queryId,
      ),
    'Every view must refer to the same query',
  );
export const ExplorationSavedViewSchema = z.strictObject({
  viewId: z.uuid(),
  title: z.string().min(1).max(160),
  visibility: z.enum(['private', 'project']),
  createdAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const CreateExplorationViewOutputSchema = z.strictObject({
  savedView: ExplorationSavedViewSchema,
});
export const ListExplorationViewsInputSchema = z.strictObject({});
export const ListExplorationViewsOutputSchema = z.strictObject({
  items: z.array(ExplorationSavedViewSchema).max(100),
});
export const OpenExplorationViewInputSchema = z.strictObject({
  viewId: z.uuid(),
});
export const OpenExplorationViewOutputSchema = z.strictObject({
  savedView: ExplorationSavedViewSchema,
  viewSpec: ExplorationViewSpecSchema,
  result: ExplorationResultV111Schema,
  selectedResource: ExplorationResourceSchema.optional(),
  selectedRecord: ExplorationRecordSchema.optional(),
  selectedNode: ExplorationGraphNodeSchema.optional(),
});
export const RevokeExplorationViewInputSchema = OpenExplorationViewInputSchema;
export const RevokeExplorationViewOutputSchema = z.strictObject({
  viewId: z.uuid(),
  revoked: z.literal(true),
});
export const ExportExplorationInputSchema = z.strictObject({
  request: ExplorationViewRequestSchema,
});
export const ExportExplorationOutputSchema = z.strictObject({
  request: ExplorationViewRequestSchema,
  result: ExplorationResultV111Schema,
  exportedAt: z.iso.datetime({ offset: true }),
  coverage: z.strictObject({
    unit: z.enum([
      'resources',
      'records',
      'versions',
      'assets',
      'evidence',
      'groups',
    ]),
    returnedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }),
});
export type ExplorationViewSpec = z.infer<typeof ExplorationViewSpecSchema>;
export type ExplorationMapView = z.infer<typeof ExplorationMapViewSchema>;
export type ExplorationViewRequest = z.infer<
  typeof ExplorationViewRequestSchema
>;
export type ExplorationSavedView = z.infer<typeof ExplorationSavedViewSchema>;
export type OpenExplorationViewOutput = z.infer<
  typeof OpenExplorationViewOutputSchema
>;
export type ExportExplorationOutput = z.infer<
  typeof ExportExplorationOutputSchema
>;
