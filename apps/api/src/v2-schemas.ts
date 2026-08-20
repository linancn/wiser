import { EntityKeySchema } from '@agent-excon/contracts';
import { z } from 'zod';

export const V2ScenarioIdParamsSchema = z.strictObject({
  scenarioId: EntityKeySchema,
});

export const V2ScenarioVersionIdParamsSchema = z.strictObject({
  scenarioVersionId: EntityKeySchema,
});

export const V2AgentIdParamsSchema = z.strictObject({
  agentId: z.string().uuid(),
});

export const V2AgentVersionIdParamsSchema = z.strictObject({
  agentVersionId: z.string().uuid(),
});

export const V2RunIdParamsSchema = z.strictObject({
  runId: z.string().uuid(),
});

export const V2TaskActionParamsSchema = z.strictObject({
  taskAction: z
    .string()
    .regex(/^[0-9a-f-]{36}:(claim|begin|heartbeat|release)$/),
});

export const V2TaskIdParamsSchema = z.strictObject({
  taskId: z.string().uuid(),
});

export const V2ArtifactIdParamsSchema = z.strictObject({
  artifactId: z.string().uuid(),
});

export const V2SubmissionIdParamsSchema = z.strictObject({
  submissionId: z.string().uuid(),
});

export const V2RunAgentHeaderSchema = z.string().uuid();

export const V2EventQuerySchema = z.strictObject({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
