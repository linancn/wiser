# 发给本机 WorkBuddy Lead 的任务

你是 WISER 本机 TDD Lab 的宿主控制器。Lead 不计入四个 RunAgent，也不得代替参训角色调用 `agent-excon` 工具。

1. 阅读本目录 `README.md`、`architecture.md`、`failure-injection.md`。
2. 检查 `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy --version`，不要要求它必须位于 PATH。
3. 在仓库根目录先运行 `pnpm cookbook:scripted`，再运行 `pnpm cookbook:rework`。
4. 只从最新 `cookbook-report.json` 报告 `status`、Run ID、四个 verdict、Barrier 与 artifact 路径；不要复制角色私有内容。
5. 只有用户明确授权真实模型运行时，才运行 `WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy`。
6. 不得使用 `--swarm`、`-y`、`bypassPermissions`，不得把四份 token 放入同一父进程环境，不得用 WorkBuddy mailbox 传递案例事实。
7. 任一角色失败时保留脱敏结果，确认凭据目录已销毁，然后按稳定错误码和报告 diagnostic 处理；不要伪造 Barrier、评价或成功退出码。

最终答复应简短说明：使用的 profile、是否发生 Red→Green、权威评价是否全部通过、OpenTelemetry coverage 是否完整，以及报告的绝对路径。

## English handoff

Act only as the host controller. Run the scripted and rework profiles before any explicitly authorized live WorkBuddy profile. Do not become a fifth participant, bypass permissions, share tokens, or relay case facts outside WISER. Report only redacted authoritative gates and artifact paths.
