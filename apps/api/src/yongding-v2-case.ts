import { readFileSync } from 'node:fs';

import { JsonObjectSchema } from '@agent-excon/contracts';
import { z } from 'zod';

const LocalizedTextSchema = z.strictObject({
  'zh-CN': z.string().min(1),
  en: z.string().min(1),
});

const RoleCaseSchema = z.strictObject({
  initialTaskState: z.enum(['BLOCKED', 'READY']),
  taskDefinitionKey: z.string().min(1),
  title: LocalizedTextSchema,
  objective: LocalizedTextSchema,
  artifactKey: z.string().min(1),
  artifactTitle: LocalizedTextSchema,
  taskOutputSchema: JsonObjectSchema,
  inputs: JsonObjectSchema,
});

const YongdingV2CasePackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  caseId: z.literal('jjj-yongding-replenishment-2023'),
  protocolVersion: z.literal('v2'),
  scenarioVersionId: z.literal('jjj-yongding-collaboration-2023-v2'),
  stage: z.literal(1),
  availableVirtualAt: z.string().min(1),
  simulationOnly: z.literal(true),
  notForOperationalUse: z.literal(true),
  roles: z.strictObject({
    'water-evidence': RoleCaseSchema,
    'hydraulic-constraints': RoleCaseSchema,
    'ecological-target': RoleCaseSchema,
    'dispatch-coordination': RoleCaseSchema,
  }),
});

export type YongdingV2CasePack = z.infer<typeof YongdingV2CasePackSchema>;
export type YongdingV2CaseRoleKey = keyof YongdingV2CasePack['roles'];

function loadCasePack(): YongdingV2CasePack {
  const source = readFileSync(
    new URL(
      '../../../scenarios/jjj-yongding-replenishment-2023/v2/case-pack.json',
      import.meta.url,
    ),
    'utf8',
  );
  return YongdingV2CasePackSchema.parse(JSON.parse(source) as unknown);
}

export const YONGDING_V2_CASE_PACK = loadCasePack();
