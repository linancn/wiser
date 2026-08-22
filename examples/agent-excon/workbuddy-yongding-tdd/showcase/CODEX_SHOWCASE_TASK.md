# 发给本机 Codex 的 WISER 展示任务

使用 `$wiser-workbuddy-showcase`。你是 WISER 演练展示导演，不是第五个
RunAgent。

仓库：当前 WISER checkout 的根目录。

1. 阅读 showcase README、Skill 的 `safety-boundaries.md` 与
   `gui-runbook.md`，运行 `pnpm showcase:preflight`。失败即停止。
   `scripted/rework` 只保证四个参训者不调用模型；WorkBuddy Lead 仍可能
   消耗订阅。如果用户禁止所有模型调用，不要打开 WorkBuddy，改走直接
   supervisor，并说明没有执行 GUI 操作。
2. 默认先展示 `scripted`，清理后再展示 `rework`。使用 Computer Use
   打开 WorkBuddy，在该仓库新建一个顶层 Lead 任务，把
   `WORKBUDDY_LEAD_SHOWCASE_TASK.md` 和所选 profile 发给它。
3. 不得代替 Lead 或四个角色调用参训 MCP。必须使用四个独立顶层进程，
   不得使用 `--swarm`、`-y`、`bypassPermissions`、共享 token 环境或
   WorkBuddy mailbox 传递业务事实。
4. 从脱敏 session 获取 Run ID 和 Web URL；不得读取 credential、MCP
   配置、lease token 或私有 Receipt 正文。可用
   `pnpm showcase:status` 只读核对。
5. 使用浏览器打开该 Run 的 `/collaboration` 页面，展示四 Agent 拓扑、
   专业角色→协调角色的 Message/Artifact、请求与回复、Receipt 送达、
   `analysis-ready`、团队方案、三方背书、`endorsement-ready`，以及
   rework 的 Red → immutable revision 2 → Green。
6. 明确区分 Event/Receipt/确定性评价与 best-effort OTel；不得从 trace
   推断 Agent 已知事实或权威成功。
7. 演示完成后，通过同一个 WorkBuddy Lead 执行
   `pnpm showcase:stop`，再运行 `pnpm showcase:status` 验证 TTL 清理、
   四个角色/Lab/Web 已停止且凭据目录已删除。

不要运行 live profile，除非用户在当前任务中另外明确授权真实模型用量
并确认 WorkBuddy 已登录且额度可用。得到授权时，唯一入口是：

```bash
WORKBUDDY_LIVE=1 pnpm showcase:start --profile workbuddy
```

live 运行遇到 429 时立即停止，不自动重试、不换模型、不把 scripted 结果
冒充 live。

最终只报告 profile、Run ID、四个最新 verdict、两个 Barrier、交互/送达
摘要、telemetry coverage、报告绝对路径和清理状态。若 Computer Use 或
浏览器不可用，停止并给出人工执行方法。

## English

Use Computer Use to operate one WorkBuddy Lead task and the browser to present
the exact Run's `/collaboration` page. Start with scripted and rework. A live
profile requires separate current authorization; stop without retry on 429 or
any authoritative or cleanup failure.
