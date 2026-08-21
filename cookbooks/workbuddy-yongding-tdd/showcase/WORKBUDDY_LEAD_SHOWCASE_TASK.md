# 发给 WorkBuddy Lead 的展示任务

你是 WISER showcase 的宿主控制器。Lead 不计入四个 RunAgent，不得调用
`agent-excon` 参训工具或代替角色提交业务内容。

Codex 会在本任务末尾注明请求的 profile。只接受 `scripted`、`rework` 或
`workbuddy`。

`scripted` 与 `rework` 只保证四个参训进程不调用模型。你作为 WorkBuddy
Lead 执行本任务时，Lead 本身仍可能使用已登录的 WorkBuddy 订阅。最终
报告必须区分这两层用量；不得把整个 scripted 展示描述为“无模型调用”。

1. 在仓库根目录运行 `pnpm showcase:preflight`，失败即报告并停止。
2. 确认没有活动展示会话后，按请求运行以下唯一对应命令：

   ```bash
   pnpm showcase:start --profile scripted
   pnpm showcase:start --profile rework
   WORKBUDDY_LIVE=1 pnpm showcase:start --profile workbuddy
   ```

3. 必须由 runner 启动四个独立顶层进程。不得使用 `--swarm`、`-y`、
   `bypassPermissions`、共享四 token 环境或 WorkBuddy mailbox 业务通信。
4. 只从 0600 脱敏 session 与 report 读取 `state`、Run ID、Web URL、四个
   verdict、Barrier、交互摘要、telemetry coverage 和 artifact 路径。
   不得打开 credential、角色 MCP 配置、lease token 或私有 Receipt。
5. 使用 `pnpm showcase:status` 确认会话进入可展示状态，然后向 Codex
   返回 Run ID、`/collaboration` URL、`expiresAt` 与 session/report 绝对
   路径。不要伪造模型 Span、评价、Barrier 或成功状态。
6. 收到 Codex 的结束指令、任一失败或 TTL 到期时，运行
   `pnpm showcase:stop`，再确认四个角色、Lab、Web 均停止，凭据与 MCP
   临时目录已删除。

`workbuddy` 会产生真实模型用量。只有 Codex 在同一条任务消息中明确写出
“用户已在当前任务授权 live WorkBuddy 用量”时才可运行。历史最近一次
live 四路均出现 429；当前再遇到 429 立即停止，不自动重试、切换模型或
回退后宣称 live 成功。

最终答复保持简短；Lead 的退出码或 Agent 自报不能替代四个最新确定性
`ACCEPTED` 与 `analysis-ready`、`endorsement-ready` 两个 Barrier。

## English

Act only as the host controller. Start the requested bounded profile, report
the redacted session and collaboration URL, and stop with verified TTL cleanup.
Live WorkBuddy requires an explicit current-authorization statement from Codex;
stop without retry on 429. Scripted participants are model-free, but the
WorkBuddy Lead may use the signed-in subscription; report those separately.
Never become a participant or share role secrets.
