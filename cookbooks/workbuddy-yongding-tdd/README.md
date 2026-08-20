# WISER 永定河四智能体 WorkBuddy TDD Cookbook

这套 Cookbook 在本机启动四个**彼此隔离的顶层 WorkBuddy 进程**，让它们以四个不同的 WISER `RunAgent` 身份进入“京津冀永定河生态补水与多水源联合调度”v2 合成演练。前端不承担参训操作；所有业务交互都经过角色专属 MCP、WISER Event/Receipt、Task lease、ArtifactVersion、Submission、Feedback 与 Barrier。

WorkBuddy Lead 只负责启动、等待、销毁凭据和读取权威报告，**不计入四个 RunAgent**，也不替任何角色提交内容。

## 三条可重复路径

在仓库根目录运行：

```bash
# 快速 Green：四个脚本智能体经真实 MCP/API 完成完整案例
pnpm cookbook:scripted

# Red → Green：首次注入水情 schema 错误，再消费 scoped grant 提交 revision 2
pnpm cookbook:rework

# 真实本机 WorkBuddy：必须显式 opt-in，使用当前 WorkBuddy 订阅登录
WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy
```

前两条不调用大模型，适合本地开发和 CI；第三条会并发启动四个真实 WorkBuddy 会话，产生模型用量且需要网络。真实运行不会读取 OpenAI-compatible API key，默认使用本机 WorkBuddy 的订阅登录。

## 前置检查

- Node.js 与 pnpm 版本满足根 `package.json` 的 `engines`。
- 已完成 `pnpm install`。
- 真实路径使用 `/Applications/WorkBuddy.app` 内置的 `codebuddy`；可用 `WORKBUDDY_CLI` 指向另一个绝对路径。
- 本地端口只绑定 `127.0.0.1`。`NODE_ENV=production` 会拒绝启动 Lab。
- 真实运行前先执行 `pnpm cookbook:scripted` 和 `pnpm cookbook:rework`。

## 四个角色

| RoleSlot                | 首要责任                             | 必交 Artifact                   |
| ----------------------- | ------------------------------------ | ------------------------------- |
| `water-evidence`        | 水情事实、时效与证据链               | `water-evidence-register`       |
| `hydraulic-constraints` | 拓扑、输水系数、容量与容差           | `hydraulic-constraint-envelope` |
| `ecological-target`     | 断面目标、连续性与风险优先级         | `ecological-priority-register`  |
| `dispatch-coordination` | 等待专业 Barrier，汇流并请求三方背书 | `candidate-joint-plan`          |

每个角色只获得自己的 case-input Receipt。专业智能体将不可变 ArtifactVersion 显式发给协调智能体；协调 Task 在三个角色评价通过前保持 `BLOCKED`。团队 Submission 必须由三个专业智能体分别 `/sync`、恢复精确修订并使用各自 grant 背书。

## 为什么不用 WorkBuddy Agent Team / swarm

默认 runner 启动四个独立顶层进程，每个进程只接触一份 0600 MCP 配置和一个 bearer token。不得使用 `--swarm`、`-y` 或 `bypassPermissions`；它们会破坏凭据最小化或权限边界。WorkBuddy mailbox 也不是业务通道：角色间事实只能通过 WISER Message / Artifact 传播，这样 Event、Receipt、trace 和评价才能完整回放。

## 输出与判定

每次运行写入 `.wiser/runs/<timestamp>-<profile>/`：

- `cookbook-report.json`：最终权威门禁、TDD cycle、Barrier 和评价摘要；0600。
- `workbuddy/results/`：每个角色的结构化结果、脱敏 stderr 与进程聚合报告；0600。
- `workbuddy/prompts/`：无凭据的角色启动提示。

成功必须同时满足：四个进程语义完成、四个角色的**最新**确定性评价为 `ACCEPTED`、`analysis-ready` 与 `endorsement-ready` 均已释放。runner 不把 WorkBuddy 自报或操作系统退出码单独当作成功证据。

Lab 结束时会删除 `lab/credentials/` 和 `workbuddy/mcp/`；报告不得包含 bearer token、lease token 或完整私有 Receipt 内容。运行是内存型的，服务重启即中止当前 Run，不能伪装成持久化恢复。

## OpenTelemetry 与导调台

WISER 将权威 Event/Receipt/评价与最佳努力 OpenTelemetry overlay 分开。导调台按场景、Run、Agent、Task 与 trace 查看双时钟过程；telemetry coverage 不完整时必须显示缺口，不能补造模型或工具 span，也不能据此推断某个智能体“已经知道”某项内容。

进一步阅读：[architecture.md](architecture.md)、[failure-injection.md](failure-injection.md) 和 [WORKBUDDY_TASK.md](WORKBUDDY_TASK.md)。

## English

This cookbook launches four isolated top-level WorkBuddy processes as four distinct WISER RunAgents in the v2 synthetic Yongding River collaboration case. Participation happens only through role-specific MCP servers; the Web console is read-only management, observability, and replay.

Run `pnpm cookbook:scripted` first, then `pnpm cookbook:rework`. A real model run requires explicit opt-in with `WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy` and uses the locally signed-in WorkBuddy subscription. The Lead is a host controller, not a fifth participant.

Never use `--swarm`, `-y`, permission bypass, shared bearer-token environments, or a WorkBuddy mailbox for case facts. A passing result requires four latest deterministic `ACCEPTED` evaluations plus both authoritative barriers; telemetry and agent self-reports are diagnostic overlays only. All credential-bearing files are destroyed when the run ends.
