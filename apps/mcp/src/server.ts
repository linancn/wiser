import {
  AllocationPlanSubmissionSchema,
  ApiErrorSchema,
  CreateArtifactVersionRequestSchema,
  CreateEpisodeRequestSchema,
  CreateRunArtifactRequestSchema,
  CreateRunMessageRequestSchema,
  CreateSubmissionEndorsementRequestSchema,
  CreateTaskSubmissionRequestSchema,
  RunSyncRequestSchema,
  TaskClaimRequestSchema,
  TaskHeartbeatRequestSchema,
  TaskLeaseCommandRequestSchema,
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
  registerWiserMcpModules,
  type WiserMcpModule,
} from './platform/modules.js';
import {
  YONGDING_SCENARIO_MARKDOWN,
  YONGDING_SCENARIO_RESOURCE_URI,
  YONGDING_V1_COMPATIBILITY_SCENARIO_MARKDOWN,
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

const RunIdSchema = z
  .string()
  .uuid('runId 必须是 UUID。 / runId must be a UUID.')
  .describe('多智能体演练 Run UUID。 / Multi-agent exercise Run UUID.');
const RunAgentIdSchema = z
  .string()
  .uuid('runAgentId 必须是 UUID。 / runAgentId must be a UUID.')
  .describe(
    '必须与当前 Bearer credential 绑定的 RunAgent UUID 一致。 / Must match the RunAgent UUID bound to the current bearer credential.',
  );
const TaskIdSchema = z
  .string()
  .uuid('taskId 必须是 UUID。 / taskId must be a UUID.');
const ArtifactIdSchema = z
  .string()
  .uuid('artifactId 必须是 UUID。 / artifactId must be a UUID.');

const V2RunAgentInputSchema = z.strictObject({
  runId: RunIdSchema,
  runAgentId: RunAgentIdSchema,
});

const V2SyncInputSchema = RunSyncRequestSchema.safeExtend({
  runId: RunIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2WaitAndSyncInputSchema = V2SyncInputSchema.extend({
  waitSeconds: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(15)
    .describe(
      '在发出一次普通 sync 前等待的墙钟秒数；不推进虚拟时钟。 / Wall-clock seconds to wait before one ordinary sync; never advances virtual time.',
    ),
});

const V2TaskClaimInputSchema = TaskClaimRequestSchema.safeExtend({
  taskId: TaskIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2TaskLeaseInputSchema = TaskLeaseCommandRequestSchema.safeExtend({
  taskId: TaskIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2TaskHeartbeatInputSchema = TaskHeartbeatRequestSchema.safeExtend({
  taskId: TaskIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2TaskSubmissionInputSchema =
  CreateTaskSubmissionRequestSchema.safeExtend({
    taskId: TaskIdSchema,
    runAgentId: RunAgentIdSchema,
    idempotencyKey: IdempotencyKeySchema,
  });

const V2MessageInputSchema = CreateRunMessageRequestSchema.safeExtend({
  runId: RunIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2ArtifactInputSchema = CreateRunArtifactRequestSchema.safeExtend({
  runId: RunIdSchema,
  runAgentId: RunAgentIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});

const V2ArtifactVersionInputSchema =
  CreateArtifactVersionRequestSchema.safeExtend({
    artifactId: ArtifactIdSchema,
    runAgentId: RunAgentIdSchema,
    idempotencyKey: IdempotencyKeySchema,
  });

const V2EndorsementInputSchema =
  CreateSubmissionEndorsementRequestSchema.safeExtend({
    submissionId: SubmissionIdSchema,
    runAgentId: RunAgentIdSchema,
    idempotencyKey: IdempotencyKeySchema,
  });

const V2ReplayInputSchema = z.strictObject({
  runId: RunIdSchema,
  runAgentId: RunAgentIdSchema,
  atRunSeq: z.number().int().positive().optional(),
  deliverySemantics: z
    .enum(['acknowledged', 'issued'])
    .default('issued')
    .describe(
      "只能选择自身已发放或已确认视角；参训智能体不能请求 eligible。 / Select only the agent's own issued or acknowledged view; participants cannot request eligible semantics.",
    ),
});

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

export const MCP_RESPONSE_CHARACTER_LIMIT = 32_000;

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
  RUN_NOT_FOUND: {
    'zh-CN': '请检查可信启动参数中的 Run ID 与当前 credential 范围。',
    en: 'Check the Run ID from the trusted bootstrap and the current credential scope.',
  },
  RUN_AGENT_NOT_FOUND: {
    'zh-CN':
      '请重新核对可信启动参数中的 RunAgent ID，不要尝试其他智能体的身份。',
    en: 'Reconcile the RunAgent ID from the trusted bootstrap; do not try another agent identity.',
  },
  RUN_STATE_CONFLICT: {
    'zh-CN': '请通过 sync 等待导调中枢发放下一步；参训智能体不能推进 Run。',
    en: 'Wait for EXCON to issue the next step through sync; a participant cannot advance the Run.',
  },
  TASK_NOT_FOUND: {
    'zh-CN': '请从自身已发放 Task 列表重新获取 taskId。',
    en: "Recover the taskId from this agent's issued Task list.",
  },
  TASK_VERSION_CONFLICT: {
    'zh-CN': '请重新列出已发放 Task，使用返回的 lockVersion 重试。',
    en: 'List issued Tasks again and retry with the returned lockVersion.',
  },
  TASK_STATE_CONFLICT: {
    'zh-CN': '请 sync 并重新列出 Task，仅在当前状态允许时执行该命令。',
    en: 'Sync and list Tasks again; run the command only when the current state permits it.',
  },
  TASK_LEASE_STALE: {
    'zh-CN':
      '丢弃该租约和由它派生的写操作，重新列出 Task 并仅在 READY 时重新领取。',
    en: 'Discard this lease and writes derived from it; list Tasks again and reclaim only when READY.',
  },
  TASK_LEASE_EXPIRED: {
    'zh-CN': '立即停止使用该租约写入，重新列出 Task 并按最新状态领取。',
    en: 'Stop writes under this lease; list Tasks again and reclaim from the latest state.',
  },
  TASK_LEASE_NOT_EXTENDED: {
    'zh-CN': '保留返回的租约状态，并在未变的到期时间前完成或释放。',
    en: 'Keep the returned lease state and finish or release before its unchanged expiry.',
  },
  TASK_LEASE_MAX_EXCEEDED: {
    'zh-CN':
      '缩短本次工作或释放租约，不要超过 maximumLeaseExpiresAt 循环续租。',
    en: 'Shorten the work or release the lease; do not renew past maximumLeaseExpiresAt.',
  },
  INVALID_TASK_LEASE_WINDOW: {
    'zh-CN': '请将领取或续租时长修正到工具 schema 允许的范围。',
    en: 'Correct the claim or renewal duration to the range allowed by the tool schema.',
  },
  RESOURCE_NOT_ISSUED: {
    'zh-CN':
      '请先调用 excon_sync 发放资源；恢复 GET 不会把 eligible 资源变为可见。',
    en: 'Call excon_sync first to issue the resource; recovery GETs do not make eligible resources visible.',
  },
  RECEIPT_CURSOR_CONFLICT: {
    'zh-CN':
      '请核对 assignment 中的 syncCursor，用自身 issued 回放重建 Receipt 链后再 sync。',
    en: "Reconcile the assignment syncCursor and rebuild this agent's Receipt chain from issued replay before syncing.",
  },
  RECEIPT_CHAIN_CONFLICT: {
    'zh-CN': '停止处理新资源，用自身 issued 回放验证 Receipt 链头。',
    en: "Stop processing new resources and verify the Receipt-chain head with this agent's issued replay.",
  },
  RECEIPT_REFERENCE_CONFLICT: {
    'zh-CN': '请仅引用自身已验证 Receipt 的 receiptId 与 receiptHash。',
    en: "Cite only receiptId and receiptHash pairs from this agent's verified Receipts.",
  },
  ARTIFACT_NOT_FOUND: {
    'zh-CN': '请从自身已发放 Artifact 列表重新获取不可变版本。',
    en: "Recover the immutable version from this agent's issued Artifact list.",
  },
  ARTIFACT_BASE_CONFLICT: {
    'zh-CN':
      '请重新获取 Artifact，以当前 versionId 作为 baseVersionId 发布新版本。',
    en: 'Recover the Artifact and publish from its current versionId as baseVersionId.',
  },
  ARTIFACT_KEY_CONFLICT: {
    'zh-CN': '请恢复已有 Artifact 或为不同语义工件使用新 artifactKey。',
    en: 'Recover the existing Artifact or use a new artifactKey for a semantically different artifact.',
  },
  SUBMISSION_CONFLICT: {
    'zh-CN':
      '请重新核对 Task、前置 Submission 与 Feedback ActionGrant，然后创建不可变后继修订。',
    en: 'Reconcile the Task, predecessor Submission, and Feedback ActionGrant, then create an immutable successor revision.',
  },
  FEEDBACK_GRANT_NOT_FOUND: {
    'zh-CN': '请 sync 并恢复自身已发放 Feedback，不要使用其他视角的 grant ID。',
    en: "Sync and recover this agent's issued Feedback; do not use a grant ID from another perspective.",
  },
  FEEDBACK_GRANT_VERSION_CONFLICT: {
    'zh-CN':
      '请恢复已发放 Feedback，确认该动作是否已消费 grant，再决定下一步。',
    en: 'Recover issued Feedback and determine whether the action already consumed the grant before proceeding.',
  },
  FEEDBACK_GRANT_SCOPE_MISMATCH: {
    'zh-CN': '该 grant 不授权当前智能体或动作；停止并等待匹配 Feedback。',
    en: 'The grant does not authorize this agent or action; stop and wait for matching Feedback.',
  },
  FEEDBACK_GRANT_REVOKED: {
    'zh-CN': '停止该动作并通过 sync 等待替代指导。',
    en: 'Stop the action and wait for replacement guidance through sync.',
  },
  FEEDBACK_GRANT_EXPIRED: {
    'zh-CN': '该 grant 已过期；不要重用，通过 sync 等待新指导。',
    en: 'The grant expired; do not reuse it, and wait for new guidance through sync.',
  },
  FEEDBACK_GRANT_EXHAUSTED: {
    'zh-CN': '该 grant 的使用次数已耗尽；不要重放另一次受保护动作。',
    en: 'The grant has no remaining uses; do not replay another protected action with it.',
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
    'zh-CN':
      '先恢复原幂等命令的结果；仅在确认是全新意图后，才使用新键提交新请求。',
    en: 'Recover the original idempotent command result first; use a new key only for a confirmed new intent.',
  },
  FORBIDDEN: {
    'zh-CN': '停止并核对可信启动身份；不要尝试其他智能体、视角或协议。',
    en: 'Stop and reconcile the trusted bootstrap identity; do not try another agent, perspective, or protocol.',
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
    const structuredContent = { ok: true as const, data };
    const machineData = JSON.stringify(structuredContent);
    const successResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: `${bilingual(success)}\n\nMACHINE_DATA:\n${machineData}`,
        },
      ],
      structuredContent,
    };
    if (JSON.stringify(successResult).length > MCP_RESPONSE_CHARACTER_LIMIT) {
      const structuredContent = {
        ok: false as const,
        error: {
          code: 'MCP_RESPONSE_TOO_LARGE',
          message: bilingual({
            'zh-CN': '响应超过 MCP 安全上限。',
            en: 'The response exceeds the MCP safety limit.',
          }),
          action: bilingual({
            'zh-CN': '请缩小 sync maxItems，或使用更窄的回放游标后重试。',
            en: 'Reduce sync maxItems or retry with a narrower replay cursor.',
          }),
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
    return successResult;
  } catch (error) {
    return errorResult(error);
  }
}

function pathId(episodeId: string): string {
  return encodeURIComponent(episodeId);
}

function participantHeaders(
  runAgentId: string,
  idempotencyKey?: string,
): Readonly<Record<string, string>> {
  return {
    'X-Run-Agent-Id': runAgentId,
    ...(idempotencyKey === undefined
      ? {}
      : { 'Idempotency-Key': idempotencyKey }),
  };
}

function registerYongdingResource(server: McpServer, markdown: string): void {
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
          text: markdown,
        },
      ],
    }),
  );
}

export function createAgentExconV1CompatibilityMcpServer(
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

  registerYongdingResource(server, YONGDING_V1_COMPATIBILITY_SCENARIO_MARKDOWN);

  return server;
}

const v2SuccessCopy = {
  assignment: {
    'zh-CN': '已核对 credential 绑定的 RunAgent、角色与 Receipt 游标。',
    en: 'The credential-bound RunAgent, role, and Receipt cursor were reconciled.',
  },
  sync: {
    'zh-CN': '已安全发放新资源，并按请求确认前一个 Receipt 链头。',
    en: 'New resources were safely issued and the prior Receipt-chain head was acknowledged as requested.',
  },
  tasks: {
    'zh-CN': '已恢复该 RunAgent 已发放的 Task。',
    en: 'Tasks already issued to this RunAgent were recovered.',
  },
  messages: {
    'zh-CN': '已恢复该 RunAgent 已发放的 Message。',
    en: 'Messages already issued to this RunAgent were recovered.',
  },
  artifacts: {
    'zh-CN': '已恢复该 RunAgent 已发放的 Artifact。',
    en: 'Artifacts already issued to this RunAgent were recovered.',
  },
  submissions: {
    'zh-CN': '已恢复该 RunAgent 已发放的精确不可变 Submission 修订。',
    en: 'Exact immutable Submission revisions already issued to this RunAgent were recovered.',
  },
  feedbackV2: {
    'zh-CN': '已恢复该 RunAgent 已发放的分层 Feedback 与 ActionGrant。',
    en: 'Layered Feedback and ActionGrants already issued to this RunAgent were recovered.',
  },
  claim: {
    'zh-CN': '已领取 Task；请仅在本地保留返回的不透明租约 token。',
    en: 'The Task was claimed; retain the returned opaque lease token only in local state.',
  },
  begin: {
    'zh-CN': '已使用当前租约开始 Task。',
    en: 'The Task was begun under the current lease.',
  },
  heartbeat: {
    'zh-CN': '已核对 Task 租约续期结果。',
    en: 'The Task lease-renewal result was reconciled.',
  },
  release: {
    'zh-CN': '已释放 Task 租约；旧 token 不得再用。',
    en: 'The Task lease was released; the old token must not be reused.',
  },
  taskSubmission: {
    'zh-CN':
      '已创建引用 Receipt/ArtifactVersion 证据的不可变 Task Submission。',
    en: 'An immutable Task Submission citing Receipt/ArtifactVersion evidence was created.',
  },
  message: {
    'zh-CN': '已发布 Message；收件人仍需通过自身 sync 获得 Receipt。',
    en: 'The Message was posted; recipients still receive it through their own sync Receipts.',
  },
  artifact: {
    'zh-CN': '已发布 Artifact 及不可变首版。',
    en: 'The Artifact and its immutable first version were published.',
  },
  artifactVersion: {
    'zh-CN': '已从指定 baseVersionId 发布不可变 ArtifactVersion。',
    en: 'An immutable ArtifactVersion was published from the specified baseVersionId.',
  },
  endorsement: {
    'zh-CN': '已消费匹配 ActionGrant 对指定 Submission 修订背书。',
    en: 'The matching ActionGrant was consumed to endorse the specified Submission revision.',
  },
  replay: {
    'zh-CN': '已获取该 RunAgent 自身的权威回放游标与最佳努力遥测覆盖。',
    en: "This RunAgent's authoritative replay cursor and best-effort telemetry coverage were retrieved.",
  },
} as const;

type IssuedResourceName =
  'artifacts' | 'feedback' | 'messages' | 'submissions' | 'tasks';

function registerIssuedResourceTool(
  server: McpServer,
  http: AgentExconHttpClient,
  resource: IssuedResourceName,
): void {
  const configuration = {
    tasks: {
      name: 'excon_list_tasks',
      title: { 'zh-CN': '列出已发放 Task', en: 'List Issued Tasks' },
      success: v2SuccessCopy.tasks,
    },
    messages: {
      name: 'excon_list_messages',
      title: {
        'zh-CN': '列出已发放 Message',
        en: 'List Issued Messages',
      },
      success: v2SuccessCopy.messages,
    },
    artifacts: {
      name: 'excon_list_artifacts',
      title: {
        'zh-CN': '列出已发放 Artifact',
        en: 'List Issued Artifacts',
      },
      success: v2SuccessCopy.artifacts,
    },
    submissions: {
      name: 'excon_list_submissions',
      title: {
        'zh-CN': '列出已发放 Submission',
        en: 'List Issued Submissions',
      },
      success: v2SuccessCopy.submissions,
    },
    feedback: {
      name: 'excon_get_feedback',
      title: {
        'zh-CN': '获取已发放 Feedback',
        en: 'Get Issued Feedback',
      },
      success: v2SuccessCopy.feedbackV2,
    },
  } as const;
  const selected = configuration[resource];

  server.registerTool(
    selected.name,
    {
      title: bilingual(selected.title),
      description:
        resource === 'submissions'
          ? bilingual({
              'zh-CN':
                '通过 GET /runs/{runId}/submissions 只恢复当前 RunAgent 已通过 excon_sync 获得 Receipt 的精确不可变 Submission 快照。背书前必须用本工具读取并审阅目标修订；不得仅凭 Feedback 中的 Submission ID 背书。',
              en: 'Recover only exact immutable Submission snapshots receipted to the current RunAgent by excon_sync through GET /runs/{runId}/submissions. Read and review the target revision with this tool before endorsement; never endorse from the Submission ID in Feedback alone.',
            })
          : bilingual({
              'zh-CN': `通过 GET /runs/{runId}/${resource} 只恢复当前 RunAgent 已有 Receipt 的资源；该读操作不会发放新内容，新内容必须使用 excon_sync。`,
              en: `Recover only resources already receipted to the current RunAgent through GET /runs/{runId}/${resource}; this read never issues new content, which requires excon_sync.`,
            }),
      inputSchema: V2RunAgentInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ runId, runAgentId }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/runs/${pathId(runId)}/${resource}`,
          headers: participantHeaders(runAgentId),
        },
        selected.success,
      ),
  );
}

function registerTaskLeaseCommandTool(
  server: McpServer,
  http: AgentExconHttpClient,
  command: 'begin' | 'release',
): void {
  const configuration = {
    begin: {
      name: 'excon_begin_task',
      title: { 'zh-CN': '开始已领取 Task', en: 'Begin Claimed Task' },
      success: v2SuccessCopy.begin,
    },
    release: {
      name: 'excon_release_task',
      title: { 'zh-CN': '释放 Task 租约', en: 'Release Task Lease' },
      success: v2SuccessCopy.release,
    },
  } as const;
  const selected = configuration[command];

  server.registerTool(
    selected.name,
    {
      title: bilingual(selected.title),
      description: bilingual({
        'zh-CN': `通过 POST /tasks/{taskId}:${command} 提交 Task lockVersion、claimEpoch 与不透明 leaseToken。安全重试必须保持 actor、路径、body 和幂等键完全不变。`,
        en: `Send the Task lockVersion, claimEpoch, and opaque leaseToken through POST /tasks/{taskId}:${command}. A safe retry must preserve the actor, path, body, and idempotency key exactly.`,
      }),
      inputSchema: V2TaskLeaseInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      taskId,
      runAgentId,
      idempotencyKey,
      expectedVersion,
      claimEpoch,
      leaseToken,
    }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/tasks/${pathId(taskId)}:${command}`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: { expectedVersion, claimEpoch, leaseToken },
        },
        selected.success,
      ),
  );
}

function createAgentExconV2McpServer(http: AgentExconHttpClient): McpServer {
  const server = new McpServer({
    name: 'agent-excon-mcp-server',
    version: '0.1.0',
  });

  server.registerTool(
    'excon_get_assignment',
    {
      title: bilingual({
        'zh-CN': '核对 RunAgent 任务指派',
        en: 'Reconcile RunAgent Assignment',
      }),
      description: bilingual({
        'zh-CN':
          '首先调用 GET /runs/{runId}/me，核对 credential 绑定的 RunAgent、角色分配、角色卡与 syncCursor。不得用返回值切换到其他智能体。',
        en: 'Call GET /runs/{runId}/me first to reconcile the credential-bound RunAgent, role assignment, role card, and syncCursor. Never use the result to switch to another agent.',
      }),
      inputSchema: V2RunAgentInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ runId, runAgentId }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/runs/${pathId(runId)}/me`,
          headers: participantHeaders(runAgentId),
        },
        v2SuccessCopy.assignment,
      ),
  );

  server.registerTool(
    'excon_sync',
    {
      title: bilingual({
        'zh-CN': '发放并确认 RunAgent 资源',
        en: 'Issue and Acknowledge RunAgent Resources',
      }),
      description: bilingual({
        'zh-CN':
          'POST /runs/{runId}/sync 是发放新 Task、Message、Artifact grant、Submission 和 Feedback 的唯一入口。使用 afterReceiptSeq，并在后续调用中用精确序号与链头哈希确认前一批。',
        en: 'POST /runs/{runId}/sync is the only entry that issues new Tasks, Messages, Artifact grants, Submissions, and Feedback. Use afterReceiptSeq and acknowledge the prior batch with its exact sequence and chain-head hash on the next call.',
      }),
      inputSchema: V2SyncInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      runId,
      runAgentId,
      idempotencyKey,
      afterReceiptSeq,
      ack,
      maxItems,
    }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/runs/${pathId(runId)}/sync`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: {
            afterReceiptSeq,
            ...(ack === undefined ? {} : { ack }),
            maxItems,
          },
        },
        v2SuccessCopy.sync,
      ),
  );

  server.registerTool(
    'excon_wait_and_sync',
    {
      title: bilingual({
        'zh-CN': '有界等待后同步 RunAgent 资源',
        en: 'Wait Then Sync RunAgent Resources',
      }),
      description: bilingual({
        'zh-CN':
          '先按墙钟有界等待，再执行恰好一次与 excon_sync 相同的发放/确认请求。用于 Barrier 等待，减少空轮询的模型 turns；不会推进 Run 虚拟时钟，也不会改变 Receipt 语义。',
        en: 'Wait for a bounded wall-clock interval, then perform exactly one issuance/acknowledgement request identical to excon_sync. Use it while waiting at Barriers to reduce empty model turns; it never advances Run virtual time or changes Receipt semantics.',
      }),
      inputSchema: V2WaitAndSyncInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      runId,
      runAgentId,
      idempotencyKey,
      afterReceiptSeq,
      ack,
      maxItems,
      waitSeconds,
    }) => {
      await new Promise<void>((resolveWait) => {
        globalThis.setTimeout(resolveWait, waitSeconds * 1_000);
      });
      return callHttp(
        http,
        {
          method: 'POST',
          path: `/runs/${pathId(runId)}/sync`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: {
            afterReceiptSeq,
            ...(ack === undefined ? {} : { ack }),
            maxItems,
          },
        },
        v2SuccessCopy.sync,
      );
    },
  );

  for (const resource of [
    'tasks',
    'messages',
    'artifacts',
    'submissions',
  ] as const) {
    registerIssuedResourceTool(server, http, resource);
  }

  server.registerTool(
    'excon_claim_task',
    {
      title: bilingual({
        'zh-CN': '领取 Task 租约',
        en: 'Claim Task Lease',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /tasks/{taskId}:claim 使用 Task 的 lockVersion 领取有界租约。仅对已由 excon_sync 发放且当前为 READY 的 Task 调用；不得记录返回的 leaseToken。',
        en: 'Claim a bounded lease with the Task lockVersion through POST /tasks/{taskId}:claim. Call only for a READY Task issued by excon_sync, and never log the returned leaseToken.',
      }),
      inputSchema: V2TaskClaimInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      taskId,
      runAgentId,
      idempotencyKey,
      expectedVersion,
      leaseSeconds,
    }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/tasks/${pathId(taskId)}:claim`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: { expectedVersion, leaseSeconds },
        },
        v2SuccessCopy.claim,
      ),
  );

  registerTaskLeaseCommandTool(server, http, 'begin');

  server.registerTool(
    'excon_heartbeat_task',
    {
      title: bilingual({
        'zh-CN': '续期 Task 租约',
        en: 'Renew Task Lease',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /tasks/{taskId}:heartbeat 核对当前 lockVersion、claimEpoch 与 leaseToken 并请求有界续期。始终使用返回的到期时间，不得超过最大租期循环续租。',
        en: 'Reconcile the current lockVersion, claimEpoch, and leaseToken and request a bounded renewal through POST /tasks/{taskId}:heartbeat. Use the returned expiry and never loop renewals beyond the maximum lease.',
      }),
      inputSchema: V2TaskHeartbeatInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      taskId,
      runAgentId,
      idempotencyKey,
      expectedVersion,
      claimEpoch,
      leaseToken,
      extendBySeconds,
    }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/tasks/${pathId(taskId)}:heartbeat`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: {
            expectedVersion,
            claimEpoch,
            leaseToken,
            extendBySeconds,
          },
        },
        v2SuccessCopy.heartbeat,
      ),
  );

  registerTaskLeaseCommandTool(server, http, 'release');

  server.registerTool(
    'excon_submit_task_result',
    {
      title: bilingual({
        'zh-CN': '提交不可变 Task 结果',
        en: 'Submit Immutable Task Result',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /tasks/{taskId}/submissions 在有效租约下提交不可变结果。必须引用至少一个自身已验证 Receipt 或已授权 ArtifactVersion；修订必须同时提供 revisionOfId 与匹配 ActionGrant。',
        en: 'Submit an immutable result under a live lease through POST /tasks/{taskId}/submissions. Cite at least one verified own Receipt or authorized ArtifactVersion; a revision requires both revisionOfId and its matching ActionGrant.',
      }),
      inputSchema: V2TaskSubmissionInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({
      taskId,
      runAgentId,
      idempotencyKey,
      expectedVersion,
      claimEpoch,
      leaseToken,
      submissionType,
      targetScope,
      payload,
      receiptRefs,
      artifactVersionRefs,
      revisionOfId,
      feedbackActionGrantId,
      endorsementRecipientRunAgentIds,
    }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/tasks/${pathId(taskId)}/submissions`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: {
            expectedVersion,
            claimEpoch,
            leaseToken,
            submissionType,
            targetScope,
            payload,
            receiptRefs,
            artifactVersionRefs,
            ...(revisionOfId === undefined ? {} : { revisionOfId }),
            ...(feedbackActionGrantId === undefined
              ? {}
              : { feedbackActionGrantId }),
            endorsementRecipientRunAgentIds,
          },
        },
        v2SuccessCopy.taskSubmission,
      ),
  );

  server.registerTool(
    'excon_post_message',
    {
      title: bilingual({
        'zh-CN': '发布 Run Message',
        en: 'Post Run Message',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /runs/{runId}/messages 向不可变收件人快照发布 inform、request、response 或 ArtifactVersion handoff。response 必须引用已通过自身 Receipt 获得的 request；Message 不是 Barrier 或 Run 时钟命令。',
        en: "Post an inform, request, response, or ArtifactVersion handoff to an immutable recipient snapshot through POST /runs/{runId}/messages. A response must reference a request already obtained through the caller's own Receipt chain. A Message is not a Barrier or Run-clock command.",
      }),
      inputSchema: V2MessageInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ runId, runAgentId, idempotencyKey, replyToMessageId, ...body }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/runs/${pathId(runId)}/messages`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body: {
            ...body,
            ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
          },
        },
        v2SuccessCopy.message,
      ),
  );

  server.registerTool(
    'excon_publish_artifact',
    {
      title: bilingual({
        'zh-CN': '发布 Artifact 首版',
        en: 'Publish Artifact First Version',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /runs/{runId}/artifacts 发布 Artifact 与不可变首版。收件人快照决定谁能通过 sync 获取 grant Receipt；如作者需后续引用或修订，应显式将自身列为收件人。',
        en: 'Publish an Artifact and immutable first version through POST /runs/{runId}/artifacts. The recipient snapshot controls who receives a grant Receipt through sync; include the author explicitly when it must later cite or extend the Artifact.',
      }),
      inputSchema: V2ArtifactInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ runId, runAgentId, idempotencyKey, ...body }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/runs/${pathId(runId)}/artifacts`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body,
        },
        v2SuccessCopy.artifact,
      ),
  );

  server.registerTool(
    'excon_publish_artifact_version',
    {
      title: bilingual({
        'zh-CN': '发布 ArtifactVersion',
        en: 'Publish Artifact Version',
      }),
      description: bilingual({
        'zh-CN':
          '通过 POST /artifacts/{artifactId}/versions 从精确 baseVersionId 追加不可变版本。发生基版本冲突时不得覆盖，必须恢复当前版本后再决定。',
        en: 'Append an immutable version from an exact baseVersionId through POST /artifacts/{artifactId}/versions. Never overwrite on a base-version conflict; recover the current version before deciding.',
      }),
      inputSchema: V2ArtifactVersionInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ artifactId, runAgentId, idempotencyKey, ...body }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/artifacts/${pathId(artifactId)}/versions`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body,
        },
        v2SuccessCopy.artifactVersion,
      ),
  );

  server.registerTool(
    'excon_endorse_submission',
    {
      title: bilingual({
        'zh-CN': '背书指定 Submission 修订',
        en: 'Endorse Exact Submission Revision',
      }),
      description: bilingual({
        'zh-CN':
          '先用 excon_sync 发放、再用 excon_list_submissions 恢复并审阅精确不可变 Submission 快照；随后通过 POST /submissions/{submissionId}/endorsements 消费匹配的 Feedback ActionGrant。不得仅凭 ID 或把背书自动延伸到后续修订。',
        en: 'First issue the exact immutable Submission snapshot with excon_sync, then recover and review it with excon_list_submissions; only then consume the matching Feedback ActionGrant through POST /submissions/{submissionId}/endorsements. Never endorse from an ID alone or extend an endorsement to later revisions.',
      }),
      inputSchema: V2EndorsementInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ submissionId, runAgentId, idempotencyKey, ...body }) =>
      callHttp(
        http,
        {
          method: 'POST',
          path: `/submissions/${pathId(submissionId)}/endorsements`,
          headers: participantHeaders(runAgentId, idempotencyKey),
          body,
        },
        v2SuccessCopy.endorsement,
      ),
  );

  registerIssuedResourceTool(server, http, 'feedback');

  server.registerTool(
    'excon_get_replay_cursor',
    {
      title: bilingual({
        'zh-CN': '获取 RunAgent 安全回放游标',
        en: 'Get RunAgent-Safe Replay Cursor',
      }),
      description: bilingual({
        'zh-CN':
          '通过 GET /runs/{runId}/replay 仅请求当前 RunAgent 自身 agent 视角的 issued 或 acknowledged 语义。工具不暴露 operator/team/role/eligible 视角；权威 Event/Receipt 与最佳努力遥测必须分开解读。',
        en: "Request only the current RunAgent's own agent perspective with issued or acknowledged semantics through GET /runs/{runId}/replay. This tool does not expose operator/team/role/eligible views; authoritative Events/Receipts and best-effort telemetry must be interpreted separately.",
      }),
      inputSchema: V2ReplayInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ runId, runAgentId, atRunSeq, deliverySemantics }) =>
      callHttp(
        http,
        {
          method: 'GET',
          path: `/runs/${pathId(runId)}/replay`,
          headers: participantHeaders(runAgentId),
          query: {
            perspective: 'agent',
            subjectId: runAgentId,
            ...(atRunSeq === undefined ? {} : { atRunSeq }),
            deliverySemantics,
          },
        },
        v2SuccessCopy.replay,
      ),
  );

  registerYongdingResource(server, YONGDING_SCENARIO_MARKDOWN);
  return server;
}

export interface AgentExconMcpServerOptions {
  readonly protocolVersion?: 'v1' | 'v2';
  readonly modules?: readonly WiserMcpModule[];
}

/**
 * Creates the v2 participant adapter by default. Legacy v1 tools are available
 * only when callers explicitly select protocolVersion: 'v1'.
 */
export function createAgentExconMcpServer(
  http: AgentExconHttpClient,
  options: AgentExconMcpServerOptions = {},
): McpServer {
  const server =
    options.protocolVersion === 'v1'
      ? createAgentExconV1CompatibilityMcpServer(http)
      : createAgentExconV2McpServer(http);
  registerWiserMcpModules(server, options.modules ?? []);
  return server;
}

export {
  registerWiserMcpModules,
  type WiserMcpModule,
} from './platform/modules.js';
