---
title: WorkBuddy Cookbook architecture and trust boundary
docType: architecture
scope: workbuddy-yongding-tdd
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 理解四个隔离进程、身份和 MCP 信任边界时
whenToUpdate:
  - 进程拓扑、凭据隔离或权威报告边界变化时
checkPaths:
  - cookbooks/workbuddy-yongding-tdd/scripts/**
  - cookbooks/workbuddy-yongding-tdd/cookbook.yaml
  - apps/api/src/v2-local-lab-runtime.ts
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# 运行架构与信任边界

```text
WorkBuddy Lead / deterministic runner（宿主，不参训）
  ├─ water-evidence WorkBuddy ── role MCP ─┐
  ├─ hydraulic-constraints WorkBuddy ─ MCP ├─ 127.0.0.1 WISER v2 Lab
  ├─ ecological-target WorkBuddy ───── MCP ┤     ├─ Event / Receipt chains
  └─ dispatch-coordination WorkBuddy ─ MCP ┘     ├─ deterministic evaluator
                                                  └─ Barrier / Feedback grants
```

## 进程与身份

- runner 并发启动四个独立顶层进程，不启用原生 Team 或 swarm。
- 每个进程只获得一个严格 MCP 配置；配置只含自身 token、`/api/v2/` loopback URL 和 MCP 入口。
- 四个 `runAgentId`、四个 token、四个 RoleSlot 必须两两绑定；交叉使用返回 403。
- WorkBuddy Lead 只做 start/wait/report/cleanup，Lead 不计入四个 RunAgent。
- 参训进程的工作目录是私有 runtime，不是源码仓库；内置写文件、Bash 和浏览器工具不在允许清单中。

## 协作与视角

专业角色的 case-input 彼此不同。业务协作只能使用 WISER Message / Artifact；仅仅同属一个团队不等于共享上下文。收件人只有在自己的 `/sync` 生成 Receipt 后才获得新内容。

协调 Task 起始为 `BLOCKED`。三个专业 Submission 各自通过确定性评价后，`analysis-ready` Barrier 释放并签发协调 Task 与三份 Artifact。协调 Submission 再由三名专业智能体分别恢复精确不可变修订并消费 scoped endorsement grant；之后 `endorsement-ready` 释放。

## 凭据生命周期

API 在非 production、仅 loopback 的内存 Lab 中创建一个 host-only operator token 与四个角色 token。原始 token 只写入 0700 目录中的 0600 文件。runner 不把 token 放进聚合报告、提示词或共享父进程环境。

无论成功或失败，服务关闭时删除 `lab/credentials/`，runner 删除 `workbuddy/mcp/`。保留的角色结果与 stderr 都经过 token 值脱敏。该 profile 的 `restartPolicy=abort-run`；重启后必须创建新 Run。

## 三重判定

1. **进程层**：OS 退出码为 0，且 WorkBuddy 最终 result envelope 是语义 success。
2. **领域层**：每个角色最新确定性评价为 `ACCEPTED`，两个 Barrier 均有权威 Event。
3. **诊断层**：OpenTelemetry trace/log/metric 只作为最佳努力 overlay；coverage 缺口显式展示，不影响 Receipt 事实，也不证明 Agent knowledge。

scripted profile 使用确定性角色驱动器，但仍通过四个真实 stdio MCP 与 HTTP API；workbuddy profile 替换的只有推理进程，协议与权威门禁不变。
