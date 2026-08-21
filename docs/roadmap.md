---
title: WISER Agent EXCON roadmap
docType: roadmap
scope: agent-excon
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when planning work or checking delivered and unfinished boundaries
whenToUpdate:
  - when milestone status, acceptance gates, or scope changes
checkPaths:
  - apps/**
  - packages/**
  - supabase/**
  - docs/design/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# WISER Agent EXCON roadmap / 路线图

## Product context / 产品上下文

**WISER — wiser water, better future**<br />
水地图：AI 赋能的水智能系统与重构引擎<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON（智能体演练场 / 导调中枢）是 WISER 的首个子系统。智能体通过 Skill + HTTP/MCP 参训；Web 负责场景管理、态势展示、可观测性和回放，不代替智能体完成演练。

Agent EXCON is WISER's first subsystem. Agents participate through Skill + HTTP/MCP; Web manages and visualizes scenarios, observability, and replay without acting as a participant.

## Explicit compatibility baseline / 显式兼容基线

v1 can run one fixed, versioned, two-stage Jing-Jin-Ji water-system Episode from creation through Observation, allocation planning, deterministic feedback, virtual-time advance, final evaluation, and event replay. It remains available only as an explicitly selected compatibility protocol.

v1 可以运行一个固定、版本化、两阶段的京津冀水系统 Episode，从创建、Observation、分配方案、确定性反馈、虚拟时间推进直到最终评价和事件回放。它只作为显式选择的兼容协议保留。

The current v1 implementation is **not** yet a facade over v2 facts. Automatic fallback between protocol versions is forbidden.

当前 v1 实现**尚未**成为 v2 事实之上的 facade；禁止在协议版本之间自动降级。

## Delivered v2 development increment / 已交付的 v2 开发增量

| Area / 领域                     | Delivered now / 当前已交付                                                                                                                                                                                                                                       | Boundary / 边界                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and core / 契约与核心 | Strict DTOs plus pure deterministic Run, Task, Barrier, Event/Receipt, feedback, and attribution state machines / 严格 DTO 与纯确定性状态机                                                                                                                      | No database, HTTP, clock, random, or AI dependencies in core / 核心不依赖数据库、HTTP、时钟、随机或 AI                                                      |
| HTTP protocol / HTTP 协议       | Scenario management, Agent versions, Run staffing/start, `/sync`, Task leases, Messages, Artifacts, Task Submissions, Receipt-gated Submission recovery, endorsements, Events, replay, and trace summaries / 场景管理、Run 编组、协作与回放                      | The Fastify v2 service is in-memory and non-durable / Fastify v2 当前为非持久化内存适配器                                                                   |
| PostgreSQL / Supabase           | v2 schema, constraints, RLS, private Event/Outbox/credential/telemetry tables, seed, and pgTAP tests / v2 schema、约束、RLS、私有表、种子与数据库测试                                                                                                            | No PostgreSQL API adapter yet / 尚无 PostgreSQL API adapter                                                                                                 |
| Agent behavior / 智能体行为     | v2-first Skill, role-aware Yongding references, and local deterministic evaluator/rework/endorsement loop / v2 默认 Skill、角色参考与本机确定性评价闭环                                                                                                          | The loop remains an in-memory development profile / 该闭环仍为内存开发 profile                                                                              |
| MCP                             | 18 v2 stdio participant tools mapped to implemented HTTP routes, including Receipt-gated recovery and bounded wait-and-sync; explicit v1 mode / 18 个与实际 HTTP 路由一致的 v2 stdio 工具，包括安全恢复与有界等待；显式 v1 模式                                  | Recovery returns only exact immutable snapshots already receipted to that RunAgent / 恢复仅返回已向该 RunAgent 发放 Receipt 的精确不可变快照                |
| Observability / 可观测性        | Authenticated participant Telemetry Ingress, OTel Collector, Tempo, Prometheus, Loki, Grafana, identity overwrite, quotas, redaction, and smoke verification / 认证入口、完整信号栈、身份覆盖、限额、脱敏与 smoke                                                | Telemetry remains best effort and never enters adjudication or audit truth / Telemetry 仍是最佳努力投影，不参与裁决或审计事实                               |
| Web                             | Chinese-default multi-scenario reference and fail-closed `live` read modes, per-agent OTel-style trace views, trust/coverage labels, and perspective replay / 中文默认的多场景 reference 与 fail-closed `live` 只读模式、分 Agent Trace、信任/覆盖标签和视角回放 | Live mode exposes missing checkpoint/topology/Span detail instead of fabricating it / live 模式显式呈现缺失的 checkpoint、topology 和 Span 明细，不伪造数据 |

## Active goal — durable multi-scenario, multi-agent platform / 当前目标

The authoritative design is [WISER Agent EXCON v2](design/v2-multi-scenario-multi-agent-observability.md).

### Acceptance boundary / 验收边界

1. The scenario center manages multiple scenarios and immutable published versions. / 场景中心管理多个场景及不可变发布版本。
2. Every new v2 scenario requires multiple roles staffed by distinct RunAgent instances and an explicit team-integration task. / 新 v2 场景必须由不同 RunAgent 占据多个角色，并包含团队汇流 Task。
3. One `ExerciseRun` hosts independent `RunAgent`, `RunTask`, and `Barrier` state; one agent cannot freeze the whole run. / 一个智能体不能冻结整场 Run。
4. Agents receive different immutable view Receipts and collaborate only through explicit Messages and ArtifactVersions. / 智能体通过差异化 Receipt 获知信息，只以显式消息和工件协作。
5. Individual, role, and team Submissions/Evaluations/Feedback remain distinct and permission-aware. / 个人、角色和团队的提交、评价、反馈彼此独立并受权限约束。
6. PostgreSQL domain Events and Receipts provide complete as-of replay for operator, team, role, and agent perspectives. / PostgreSQL Event/Receipt 提供完整当时视角回放。
7. OpenTelemetry projects EXCON boundary spans and accepts authenticated participant-reported agent/model/tool spans; the UI labels trust and coverage, and telemetry never becomes the audit source. / OTel 展示平台边界和经认证的参训者自报数据，但永不成为审计源。
8. Web separates scenario management from the read-only Run observatory and never simulates participant actions. / Web 区分场景管理与只读导调观察，绝不模拟参训操作。
9. Chinese remains the default; English preserves the same routes, state, filters, and replay cursors. / 中文默认，英文功能与路由同构。
10. v1 calls translate through a compatibility facade onto v2 facts until usage reaches zero. / v1 最终必须经 compatibility facade 翻译到 v2 事实，直至调用量归零。

### Milestone status / 里程碑状态

- **M0 — Design and reference UI / 设计与参考界面: delivered.** v2 ADR, bilingual design, multi-scenario catalog, multi-agent trace waterfall, and perspective replay fixture are present.
- **M1 — Contracts and protocol API / 契约与协议 API: delivered as an in-memory development slice.** Public/manage scenarios, Agent/Run, participant collaboration, safe replay, and telemetry overlay routes are implemented and tested.
- **M2 — Domain and database / 领域与数据库: partial.** Pure concurrency/receipt state machines and the Supabase schema/RLS are delivered; the PostgreSQL API adapter and durable transactions are not.
- **M3 — Agent protocol / 智能体协议: delivered for the local in-memory profile.** The v2 Skill, 18 MCP tools, bounded wait, Receipt-gated Submission recovery, and deterministic four-role evaluator/rework/endorsement loop are delivered; durable wiring remains under M2.
- **M4 — Observability profile / 可观测性: delivered for local drill-down.** Telemetry Ingress, Collector, Tempo, Prometheus, Loki, Grafana, redaction, identity enforcement, correlation, and smoke verification are included.
- **M5 — Authoritative replay and migration / 权威回放与迁移: partial.** The in-memory service provides as-of projections and management routes; durable PostgreSQL projection, v1 facade/backfill, and cold-history reconciliation remain.

## Next delivery gates / 下一交付关口

1. Implement the PostgreSQL API adapter with explicit transactions, row locks/optimistic versions, idempotency, Event/Receipt/outbox atomicity, and production credential verification. / 实现 PostgreSQL API adapter 及原子事务边界。
2. Move v1 onto an explicit facade backed by v2 facts, reconcile unfinished Episodes, then backfill cold history. / 将 v1 迁移为 v2 事实上的显式 facade。

## Still out of scope / 仍不在范围内

- Hidden chain-of-thought capture or display. / 捕获或展示隐藏思维链。
- OTel/Grafana as the business event store, authorization layer, or scoring source. / 把 OTel/Grafana 当作业务事实、权限或评分源。
- LLM-generated deterministic scores, barriers, or verdicts. / 由 LLM 生成确定性分数、Barrier 或 verdict。
- Default internal orchestration of participant agents. / 默认由平台内部编排参训智能体。
- Kubernetes, Redis, Kafka, and production GIS editing in the first durable v2 release. / 首个持久化 v2 中引入 Kubernetes、Redis、Kafka 或生产 GIS 编辑。
