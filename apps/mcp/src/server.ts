import {
  AllocationPlanSubmissionSchema,
  ApiErrorSchema,
  CreateEpisodeRequestSchema,
} from '@agent-excon/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  AgentExconApiError,
  type AgentExconHttpClient,
  type AgentExconHttpRequest,
  type JsonValue,
} from './http-client.js';
import {
  YONGDING_SCENARIO_MARKDOWN,
  YONGDING_SCENARIO_RESOURCE_URI,
} from './scenario-resource.js';

export { YONGDING_SCENARIO_RESOURCE_URI } from './scenario-resource.js';

interface BilingualCopy {
  readonly 'zh-CN': string;
  readonly en: string;
}

function bilingual(copy: BilingualCopy): string {
  return `${copy['zh-CN']} / ${copy.en}`;
}

const descriptions = {
  episodeId: bilingual({
    'zh-CN': '演练实例 UUID。',
    en: 'Episode UUID.',
  }),
  idempotencyKey: bilingual({
    'zh-CN': '本次写操作的 UUID 幂等键；安全重试时复用同一个值。',
    en: 'UUID idempotency key; reuse it when safely retrying this write.',
  }),
  expectedVersion: bilingual({
    'zh-CN': '最近一次观察到的 Episode 正整数版本。',
    en: 'Latest observed positive Episode version.',
  }),
  plan: bilingual({
    'zh-CN': '符合共享契约的分阶段水源分配方案。',
    en: 'Stage-specific water-source allocation plan conforming to the shared contract.',
  }),
} as const;

const EpisodeIdSchema = z
  .string()
  .uuid('episodeId 必须是 UUID。 / episodeId must be a UUID.')
  .describe(descriptions.episodeId);
const SubmissionIdSchema = z
  .string()
  .uuid('submissionId 必须是 UUID。 / submissionId must be a UUID.');
const IdempotencyKeySchema = z
  .string()
  .uuid('幂等键必须是 UUID。 / The idempotency key must be a UUID.')
  .describe(descriptions.idempotencyKey);

export const StartEpisodeInputSchema = CreateEpisodeRequestSchema.extend({
  idempotencyKey: IdempotencyKeySchema,
});

export const GetEpisodeInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
});

export const ObserveInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  expectedVersion: z
    .number()
    .int()
    .positive()
    .describe(descriptions.expectedVersion),
  informationIds: z
    .array(z.string().min(3).max(128))
    .min(1)
    .max(100)
    .optional()
    .describe(
      bilingual({
        'zh-CN': '可选的当前已释放信息 ID；省略时交付全部当前可见信息。',
        en: 'Optional currently released information IDs; omit to deliver all currently visible information.',
      }),
    ),
});

export const ListObservationsInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  limit: z.number().int().min(1).max(100).default(50),
});

export const SubmitAllocationPlanInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  expectedVersion: z
    .number()
    .int()
    .positive()
    .describe(descriptions.expectedVersion),
  plan: AllocationPlanSubmissionSchema.describe(descriptions.plan),
});

export const GetFeedbackInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
});

export const GetEvaluationInputSchema = z.strictObject({
  submissionId: SubmissionIdSchema,
});

export const AdvanceInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  expectedVersion: z
    .number()
    .int()
    .positive()
    .describe(descriptions.expectedVersion),
});

export const GetEventsInputSchema = z.strictObject({
  episodeId: EpisodeIdSchema,
  after: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
});

const ToolOutputSchema = z
  .strictObject({
    ok: z.boolean(),
    data: z.json().optional(),
    error: z
      .strictObject({
        code: z.string(),
        message: z.string(),
        action: z.string(),
        traceId: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((output, context) => {
    if (output.ok && output.data === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: '成功输出必须包含 data。 / Successful output requires data.',
      });
    }
    if (!output.ok && output.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message:
          '失败输出必须包含 error。 / Error output requires error details.',
      });
    }
  });

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const idempotentWriteAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const advanceAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const successCopy: Readonly<Record<string, BilingualCopy>> = {
  start: {
    'zh-CN': '演练实例已创建或由幂等重试返回。',
    en: 'The episode was created or returned by an idempotent retry.',
  },
  episode: {
    'zh-CN': '已获取当前演练状态和版本。',
    en: 'The current episode state and version were retrieved.',
  },
  observe: {
    'zh-CN': '已获取当前参与者可见的观察。',
    en: 'Participant-visible observations were retrieved.',
  },
  observations: {
    'zh-CN': '已获取此前交付的完整 Observation 记录。',
    en: 'Previously delivered full Observation records were retrieved.',
  },
  submit: {
    'zh-CN': '分配方案已作为不可变提交保存。',
    en: 'The allocation plan was saved as an immutable submission.',
  },
  feedback: {
    'zh-CN': '已获取当前可见反馈。',
    en: 'Currently visible feedback was retrieved.',
  },
  evaluation: {
    'zh-CN': '已获取该提交的确定性评价状态。',
    en: 'The deterministic evaluation status for the submission was retrieved.',
  },
  advance: {
    'zh-CN': '演练时间或阶段已推进。',
    en: 'The episode time or stage was advanced.',
  },
  events: {
    'zh-CN': '已获取参与者可见的事件 Trace。',
    en: 'The participant-visible Event trace was retrieved.',
  },
};

const actionByCode: Readonly<Record<string, BilingualCopy>> = {
  VALIDATION_FAILED: {
    'zh-CN': '请按工具输入 schema 修正字段后重试。',
    en: 'Correct the fields using the tool input schema, then retry.',
  },
  EPISODE_NOT_FOUND: {
    'zh-CN': '请检查 Episode ID 与当前 token 的访问范围。',
    en: 'Check the Episode ID and the current token scope.',
  },
  EPISODE_VERSION_CONFLICT: {
    'zh-CN': '请重新观察演练状态后，使用最新版本重试。',
    en: 'Observe the episode again, then retry with its latest version.',
  },
  EPISODE_STATE_CONFLICT: {
    'zh-CN': '请先获取反馈并确认 allowedActions，再选择下一步工具。',
    en: 'Retrieve feedback, inspect allowedActions, then choose the next tool.',
  },
  EVIDENCE_NOT_OBSERVED: {
    'zh-CN': '请仅引用 excon_observe 已返回的 evidenceRef。',
    en: 'Reference only evidenceRefs returned by excon_observe.',
  },
  EVIDENCE_NOT_RELEVANT: {
    'zh-CN':
      '请重新获取当前 Observation，并让每个水源决策引用当前阶段完整规则 informationId。',
    en: 'List current Observations again and make every source decision cite the current-stage complete-rule informationId.',
  },
  IDEMPOTENCY_CONFLICT: {
    'zh-CN': '请求体变化时请生成新的幂等键；安全重试则保持原请求不变。',
    en: 'Generate a new idempotency key for a changed body; keep the original request unchanged for a safe retry.',
  },
  NOT_AUTHORIZED: {
    'zh-CN': '请为参训 token 配置所需 scope，且不要把 token 放入工具参数。',
    en: 'Grant the participant token the required scope, and never put the token in tool arguments.',
  },
  INTERNAL_ERROR: {
    'zh-CN': '请稍后重试；若问题持续，请向运维人员提供 traceId。',
    en: 'Retry later; if the issue persists, give the traceId to an operator.',
  },
};

const actionByStatus: Readonly<Record<number, BilingualCopy>> = {
  401: actionByCode.NOT_AUTHORIZED!,
  403: actionByCode.NOT_AUTHORIZED!,
  404: actionByCode.EPISODE_NOT_FOUND!,
  409: actionByCode.EPISODE_STATE_CONFLICT!,
  422: actionByCode.VALIDATION_FAILED!,
  429: {
    'zh-CN': '请等待 Retry-After 指定的时间后重试。',
    en: 'Wait for the Retry-After interval before retrying.',
  },
};

function genericAction(): BilingualCopy {
  return {
    'zh-CN': '请确认 API 服务可达、环境变量有效，然后重试。',
    en: 'Confirm the API is reachable and the environment is valid, then retry.',
  };
}

function errorResult(error: unknown): CallToolResult {
  if (error instanceof AgentExconApiError) {
    const parsed = ApiErrorSchema.safeParse(error.payload);
    if (parsed.success) {
      const apiError = parsed.data.error;
      const action =
        actionByCode[apiError.code] ??
        actionByStatus[error.status] ??
        genericAction();
      const structuredContent = {
        ok: false as const,
        error: {
          code: apiError.code,
          message: apiError.message,
          action: bilingual(action),
          traceId: apiError.traceId,
        },
      };
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `${apiError.code}: ${apiError.message}\n${bilingual(action)}`,
          },
        ],
        structuredContent,
      };
    }

    const action = actionByStatus[error.status] ?? genericAction();
    const structuredContent = {
      ok: false as const,
      error: {
        code: `HTTP_${error.status}`,
        message: bilingual({
          'zh-CN': 'Agent EXCON API 拒绝了请求。',
          en: 'The Agent EXCON API rejected the request.',
        }),
        action: bilingual(action),
      },
    };
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `${structuredContent.error.message}\n${structuredContent.error.action}`,
        },
      ],
      structuredContent,
    };
  }

  const action = genericAction();
  const structuredContent = {
    ok: false as const,
    error: {
      code: 'MCP_HTTP_ADAPTER_ERROR',
      message: bilingual({
        'zh-CN': '无法完成 Agent EXCON HTTP 请求。',
        en: 'The Agent EXCON HTTP request could not be completed.',
      }),
      action: bilingual(action),
    },
  };
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${structuredContent.error.message}\n${structuredContent.error.action}`,
      },
    ],
    structuredContent,
  };
}

async function callHttp(
  http: AgentExconHttpClient,
  request: AgentExconHttpRequest,
  success: BilingualCopy,
): Promise<CallToolResult> {
  try {
    const data: JsonValue = await http.request(request);
    return {
      content: [{ type: 'text', text: bilingual(success) }],
      structuredContent: { ok: true, data },
    };
  } catch (error) {
    return errorResult(error);
  }
}

function pathId(episodeId: string): string {
  return encodeURIComponent(episodeId);
}

export function createAgentExconMcpServer(
  http: AgentExconHttpClient,
): McpServer {
  const server = new McpServer({
    name: 'agent-excon-mcp-server',
    version: '0.1.0',
  });

  server.registerTool(
    'excon_start_episode',
    {
      title: bilingual({
        'zh-CN': '创建智能体演练',
        en: 'Start Agent Exercise',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /episodes 创建固定场景版本的演练实例；安全重试必须复用幂等键。',
        en: 'Create an episode from a pinned scenario version through POST /episodes; safe retries must reuse the idempotency key.',
      }),
      inputSchema: StartEpisodeInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ scenarioVersionId, participantVersionId, idempotencyKey }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: '/episodes',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: { scenarioVersionId, participantVersionId },
        },
        successCopy.start!,
      ),
  );

  server.registerTool(
    'excon_get_episode',
    {
      title: bilingual({
        'zh-CN': '获取演练状态',
        en: 'Get Episode State',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /episodes/{episodeId} 对账当前状态、虚拟时间和乐观版本；用于冲突或模糊写响应后的安全恢复。',
        en: 'Reconcile current state, virtual time, and optimistic version through GET /episodes/{episodeId}; use after conflicts or ambiguous write responses.',
      }),
      inputSchema: GetEpisodeInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ episodeId }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/episodes/${pathId(episodeId)}`,
        },
        successCopy.episode!,
      ),
  );

  server.registerTool(
    'excon_observe',
    {
      title: bilingual({
        'zh-CN': '获取演练观察',
        en: 'Observe Exercise',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /episodes/{episodeId}/observe 交付当前 token 可见的信息并记录实际访问；安全重试必须复用幂等键。',
        en: 'Deliver information visible to the current token and record actual access through POST /episodes/{episodeId}/observe; safe retries must reuse the idempotency key.',
      }),
      inputSchema: ObserveInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ episodeId, idempotencyKey, expectedVersion, informationIds }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/episodes/${pathId(episodeId)}/observe`,
          headers: { 'Idempotency-Key': idempotencyKey },
          body: {
            episodeVersion: expectedVersion,
            ...(informationIds === undefined ? {} : { informationIds }),
          },
        },
        successCopy.observe!,
      ),
  );

  server.registerTool(
    'excon_list_observations',
    {
      title: bilingual({
        'zh-CN': '列出已交付观察',
        en: 'List Delivered Observations',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /episodes/{episodeId}/observations 恢复当前参与者此前获得的完整 Observation 与时间字段。',
        en: 'Recover the current participant’s previously delivered full Observation records and timestamps through GET /episodes/{episodeId}/observations.',
      }),
      inputSchema: ListObservationsInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ episodeId, limit }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/episodes/${pathId(episodeId)}/observations`,
          query: { limit },
        },
        successCopy.observations!,
      ),
  );

  server.registerTool(
    'excon_submit_allocation_plan',
    {
      title: bilingual({
        'zh-CN': '提交永定河联合调度方案',
        en: 'Submit Yongding Allocation Plan',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /episodes/{episodeId}/submissions 提交契约校验后的不可变水源分配方案；证据必须来自本 Episode 的观察。',
        en: "Submit a contract-validated immutable water-source allocation plan through POST /episodes/{episodeId}/submissions; evidence must come from this Episode's observations.",
      }),
      inputSchema: SubmitAllocationPlanInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ episodeId, idempotencyKey, expectedVersion, plan }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/episodes/${pathId(episodeId)}/submissions`,
          headers: { 'Idempotency-Key': idempotencyKey },
          body: { episodeVersion: expectedVersion, plan },
        },
        successCopy.submit!,
      ),
  );

  server.registerTool(
    'excon_get_evaluation',
    {
      title: bilingual({
        'zh-CN': '获取提交评价',
        en: 'Get Submission Evaluation',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /submissions/{submissionId}/evaluation 对账确定性评价；异步实现可能返回 pending。',
        en: 'Reconcile deterministic evaluation through GET /submissions/{submissionId}/evaluation; asynchronous implementations may return pending.',
      }),
      inputSchema: GetEvaluationInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ submissionId }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/submissions/${encodeURIComponent(submissionId)}/evaluation`,
        },
        successCopy.evaluation!,
      ),
  );

  server.registerTool(
    'excon_get_feedback',
    {
      title: bilingual({
        'zh-CN': '获取导调反馈',
        en: 'Get Exercise Feedback',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /episodes/{episodeId}/feedback 获取当前参与者可见的确定性评价反馈和 allowedActions。',
        en: 'Retrieve participant-visible deterministic feedback and allowedActions through GET /episodes/{episodeId}/feedback.',
      }),
      inputSchema: GetFeedbackInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ episodeId }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/episodes/${pathId(episodeId)}/feedback`,
        },
        successCopy.feedback!,
      ),
  );

  server.registerTool(
    'excon_advance',
    {
      title: bilingual({
        'zh-CN': '推进演练阶段',
        en: 'Advance Exercise',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /episodes/{episodeId}/advance 不可逆地推进虚拟时间或阶段。仅在反馈的 allowedActions 允许时调用。',
        en: 'Irreversibly advance virtual time or stage through POST /episodes/{episodeId}/advance. Call only when feedback allowedActions permits it.',
      }),
      inputSchema: AdvanceInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: advanceAnnotations,
    },
    async ({ episodeId, idempotencyKey, expectedVersion }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/episodes/${pathId(episodeId)}/advance`,
          headers: { 'Idempotency-Key': idempotencyKey },
          body: { episodeVersion: expectedVersion },
        },
        successCopy.advance!,
      ),
  );

  server.registerTool(
    'excon_get_events',
    {
      title: bilingual({
        'zh-CN': '获取演练 Trace',
        en: 'Get Exercise Trace',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /episodes/{episodeId}/events 按事件序号读取参与者可见的不可变 Trace。',
        en: 'Read the participant-visible immutable trace by event sequence through GET /episodes/{episodeId}/events.',
      }),
      inputSchema: GetEventsInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ episodeId, after, limit }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/episodes/${pathId(episodeId)}/events`,
          query: { after, limit },
        },
        successCopy.events!,
      ),
  );

  server.registerResource(
    'jing-jin-ji-yongding-river-scenario',
    YONGDING_SCENARIO_RESOURCE_URI,
    {
      title: bilingual({
        'zh-CN': '京津冀永定河合成演练说明',
        en: 'Jing-Jin-Ji Yongding River Synthetic Exercise Guide',
      }),
      description: bilingual({
        'zh-CN': '多水源联合调度演练的事实边界、合成约束与工具流程。',
        en: 'Fact boundary, synthetic constraints, and tool workflow for the multi-source allocation exercise.',
      }),
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: YONGDING_SCENARIO_MARKDOWN,
        },
      ],
    }),
  );

  return server;
}
