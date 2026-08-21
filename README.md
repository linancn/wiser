---
title: WISER 项目概览
docType: overview
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 了解项目边界、当前状态与本机入口时
whenToUpdate:
  - 产品边界、交付状态或开发入口变化时
checkPaths:
  - apps/**
  - packages/**
  - compose.yaml
  - docs/roadmap.md
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# WISER · 水地图

[English](./README.en.md) · 中文（默认）

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

WISER 面向水系统的感知、推演、决策与重构。当前首个开源核心子系统是**智能体演练场 / Agent EXCON**：它把真实世界任务封装为可运行、可回放、可验证的演练场景，并通过 HTTP、MCP 与文件化 Skill 向异构智能体开放。

仓库从一个可验证的单智能体兼容纵切开始：京津冀永定河流域生态补水与多水源联合调度。当前默认开发协议已是 v2 多场景、多角色团队演练：水情证据、水动力约束、生态目标与调度协调智能体获得不同 Receipt、并行完成 Task，并以 Message、ArtifactVersion、Submission 和 Feedback 显式协作。

演练由智能体加载 [`skills/agent-excon`](./skills/agent-excon/SKILL.md) 后通过 HTTP 或 MCP 运行。Web 不模拟智能体参训；它负责多场景管理、导调态势、按 Agent 的 OTel 式 Trace 和基于领域事件/Receipt 的当时视角回放。

## 工程原则

- 真实用例驱动的 Red → Green → Refactor；每个行为先由测试定义。
- 确定性裁决优先；AI 只生成解释性摘要，不决定分数或最终裁决。
- 本机开发调试默认复用 `codex login`，CI 与部署使用 fake 或 OpenAI-compatible provider。
- Supabase 提供 Auth、PostgreSQL、Storage 与本地开发工具；复杂事务使用 `pg` + SQL。
- PostgreSQL 状态表承担初期异步任务，不引入 Redis 或额外消息队列。
- 中文界面和文档为默认，英文内容保持一一对应。

## 已交付的 v2 增量

- `packages/contracts` 与纯 `packages/core` 已定义 Scenario/Version/Run/RunAgent/Task/Barrier、Receipt/Event、Message/Artifact、Submission/Feedback 及确定性状态机。
- Fastify 已提供多场景管理、Run 编组、Receipt `/sync`、Task 租约、协作工件、提交/背书和安全回放的 `/api/v2` 开发纵切；当前实现是**内存协议适配器**，进程重启后不保留状态。
- Supabase 已有 v2 PostgreSQL schema、约束、RLS、私有 Event/Outbox/credential/telemetry 表和 pgTAP 覆盖，但 Fastify 尚未接入 PostgreSQL API adapter。
- Agent EXCON Skill 已以 v2 RunAgent 循环为默认；stdio MCP 已实现与 HTTP 路由一致的 18 个 v2 参训工具，包括 Receipt-gated 的 Submission 安全恢复与不推进虚拟时钟的有界 wait-and-sync。v1 只在显式选择兼容模式时启用，不会自动降级。
- 本机 WorkBuddy Cookbook 已能用四个隔离的顶层进程运行真实 Yongding v2 协作链；scripted 与故障注入 profile 均经过真实 MCP，覆盖确定性评价、scoped rework、三方背书与两个 Barrier，真实 WorkBuddy 仅在显式 opt-in 时启动。
- Compose `observability` profile 已包含认证 Telemetry Ingress、OTel Collector、Tempo、Prometheus、Loki 和 Grafana；领域 Event/Receipt 始终是权威事实，OTel 只是最佳努力诊断投影。
- Web 已交付中文默认的多场景、分 Agent Trace、视角回放与 authority-aware 诊断板；4/4 评价、Barrier、Red→Green 修订账本与 OTel Trace/Span/Log/Metric coverage 分轨展示。reference/live 均只读，`live` 失败时显式显示数据缺口，不回退或伪造参训过程。

尚未交付的关键边界是 PostgreSQL API adapter，以及把 v1 翻译到 v2 事实的 compatibility facade。因此当前 v2 适合协议/TDD/本地调试，不应被描述为持久化生产平台。

## 目标中的仓库结构

```text
apps/          HTTP API、只读 Web、Worker、MCP 与 Fumadocs 文档
cookbooks/     本机多智能体 TDD、WorkBuddy 启动与脱敏报告
packages/      协议、纯领域核心与基础设施适配器
scenarios/     版本化演练场景及来源清单
skills/        可独立发布的 Agent EXCON Skill
supabase/      配置、迁移、种子与数据库测试
tests/         跨边界验收测试
```

## 环境基线

- Node.js 24 LTS（推荐 `24.19.0`，兼容范围 `>=24.18.0 <25`）
- pnpm 11
- Docker Engine 29+ / Docker Compose 5+
- Codex CLI（本机开发的默认 AI provider）

安装并验证：

```bash
corepack enable
pnpm install
pnpm verify
```

仓库使用 Docpact 0.1.9 确定性地关联代码变更与文档义务。安装后，可在编码前查询阅读路径，并在编码后检查工作区变更：

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'packages/core/src/**'
pnpm docpact:check
```

规则位于 [`.docpact/config.yaml`](./.docpact/config.yaml)，PR 会在 CI 中执行阻断检查。

启动完整开发栈：

```bash
pnpm stack:up
```

这会先由 Supabase CLI 启动 Auth/PostgreSQL 17/Storage/Studio，再由 Compose 启动 API、只读 Web、Worker 和文档。默认地址为 Web `:3000`、API `:3001`、Worker health `:3002`、文档 `:4321`、Supabase Studio `:56323`。停止使用 `pnpm stack:down`。

按需启动本地技术观测栈：

```bash
pnpm observability:up
```

它在回环地址提供参训者 OTLP/HTTP Ingress `:14318`、平台 OTLP `:4317/:4318`、Grafana `:3300` 和 Prometheus `:9090`，并用 Tempo/Loki 保存本地 Trace/Log。Ingress 绑定 RunAgent、覆盖自报身份、限流并拒绝敏感字段；`pnpm observability:down` 只停止这些服务并保留命名卷。

本机 Codex 订阅只供可信开发调试，运行在宿主机；容器和 CI 默认使用 fake provider。切勿提交或挂载 `~/.codex/auth.json`、Supabase service-role key 或其他凭据。

## 项目状态

v2 的契约、纯领域核心、内存 HTTP 协作纵切、数据库 schema/RLS、Skill、18 个 MCP 工具、Submission 安全恢复、确定性评价/返工/背书闭环和认证观测链路已经可验证；[WorkBuddy TDD Cookbook](./cookbooks/workbuddy-yongding-tdd/README.md) 提供可重复的四智能体本机入口。持久化接线仍在进行。v1 Episode 保留为**显式兼容协议**，目前仍是独立实现，而不是已完成的 v2 facade。范围与验收标准记录在 [`docs/roadmap.md`](./docs/roadmap.md)，完整设计见 [`docs/design/v2-multi-scenario-multi-agent-observability.md`](./docs/design/v2-multi-scenario-multi-agent-observability.md)，贡献约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可

代码采用 [MIT License](./LICENSE)。场景数据和第三方材料按各自的 `PROVENANCE.md` 与数据许可管理；MIT 许可不会自动覆盖这些材料。
