---
title: WISER WorkBuddy 四智能体演练展示包
docType: runbook
scope: workbuddy-showcase
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 启动或验证 WorkBuddy 四智能体协作展示时
whenToUpdate:
  - showcase profile、脚本、session schema 或 GUI 流程变化时
checkPaths:
  - examples/agent-excon/workbuddy-yongding-tdd/showcase/**
  - skills/wiser-workbuddy-showcase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

# WISER WorkBuddy 四智能体演练展示包

这个展示包让本机 Codex 操作 WorkBuddy GUI，由 WorkBuddy Lead 启动四个
彼此隔离的参训进程，同时在 WISER `/collaboration` 导调页展示 Message、
ArtifactVersion、Receipt、回复、评价、背书与 Barrier。Codex 和 Lead 都
是宿主控制器，不是第五个 RunAgent。

## Profile

| Profile     | 用途                                      | 四参训者模型用量 |
| ----------- | ----------------------------------------- | ---------------- |
| `scripted`  | 确定性完整协作链，默认展示                | 无               |
| `rework`    | 水情 schema Red → scoped revision 2 Green | 无               |
| `workbuddy` | 四个真实本机 WorkBuddy 参训进程           | 有               |

表中只描述四个参训者。若由 Codex 在 WorkBuddy GUI 中新建 Lead 任务，Lead
本身仍可能消耗 WorkBuddy 订阅。用户要求完全零模型调用时，不得打开
WorkBuddy；应直接运行确定性 supervisor，并明确说明未进行 GUI 操作。

真实 profile 必须得到当前用户明确授权，并使用
`WORKBUDDY_LIVE=1`。演示前由用户确认登录和额度；不得用付费请求做自动
探测，也不得自动重试 429。

## 生命周期

```bash
pnpm showcase:preflight
pnpm showcase:start --profile scripted
pnpm showcase:start --profile rework
WORKBUDDY_LIVE=1 pnpm showcase:start --profile workbuddy
pnpm showcase:status
pnpm showcase:stop
```

每个 profile 必须独占一个会话：preflight → start → status/展示 → stop →
cleanup。默认 TTL 是十五分钟（900 秒），监督器到期自动停止四个角色、
Lab 和 Web，并删除临时凭据。切换 profile 前也必须先 stop 并验证清理。

`showcase-session.json` 使用 0600 权限，只包含脱敏的 profile、状态、
Run ID、Web URL、到期时间、报告路径和清理状态。它不得包含 operator
token、参训 token、lease token、私有 Receipt 正文或 MCP 配置路径。

## Codex 入口

把 [CODEX_SHOWCASE_TASK.md](CODEX_SHOWCASE_TASK.md) 发给本机 Codex，或
显式使用 `$wiser-workbuddy-showcase`。Codex 必须通过 Computer Use 操作
WorkBuddy，通过浏览器打开 session 返回的 `/collaboration` URL。若 UI
控制不可用，只能交付人工步骤，不能声称已经操作。

WorkBuddy Lead 使用
[WORKBUDDY_LEAD_SHOWCASE_TASK.md](WORKBUDDY_LEAD_SHOWCASE_TASK.md)。Lead
不得参加业务协作、读取四份凭据或使用 WorkBuddy mailbox 传递案例事实。

## 成功与停止

展示成功仍要求四个角色最新确定性评价均为 `ACCEPTED`，并同时存在
`analysis-ready` 与 `endorsement-ready`。通信图、退出码和 OTel overlay
都不能替代这些权威门禁。任何 429、身份/Receipt/lease 冲突、缺失
Barrier、TTL 到期或清理失败都必须停止并如实报告。

## English

This package lets local Codex operate one WorkBuddy host-controller task while
four isolated participant processes exercise the WISER Yongding case. The
scripted and rework profiles are deterministic and model-free. The live
WorkBuddy profile requires explicit current authorization, available quota,
and `WORKBUDDY_LIVE=1`. Every session has a 15-minute TTL and must end with
verified credential and process cleanup.
