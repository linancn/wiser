---
title: v1 迁移与 v2 TDD
description: 从单 Agent Episode 安全切换到多 Agent Run 的在线顺序和首批失败测试。
docType: migration-guide
scope: agent-excon-v2
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 v1 兼容、v2 迁移或确定性评价流程时
whenToUpdate:
  - 迁移顺序、TDD 关口或持久化状态变化时
checkPaths:
  - apps/worker/**
  - packages/infra/**
  - supabase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: b571be6e7e1abef540cbda607c4807f000714d33
---

## 迁移原则

v1 walking skeleton 继续作为兼容协议，但事实写入逐步统一到 v2。不能长期双写 Episode 和 Run 两套表，否则 Event、Receipt 与状态无法保持原子一致。

Supabase 管理 Auth、平台控制面和 EXCON 数据，其 migration、declarative schema、seed 与 pgTAP 必须同步。未来独立的 Data Foundation `data-postgres` 使用自己的带校验和 SQL runner、advisory lock 与迁移历史；两套数据库不得混用迁移目录或伪造跨库事务。

## 在线切换顺序

1. 部署 v2 表、RLS、Task/Barrier、Event/Receipt/Outbox 和 `legacy_episode_map`，v1 路由暂时不变。
2. 把现有 ParticipantVersion 映射为不可变 AgentVersion，并发布只有一个 legacy 角色的兼容蓝图；新 v2 场景仍必须由不同 RunAgent 占据多个角色。
3. 在 Facade cutover 前迁移全部未完成 Episode 并对账。遗漏对象在第一次 v1 写入时，以单个 serializable 事务原子导入。
4. 一旦 Episode 有 map，旧事实表立即拒绝该对象的写入；v1 observe/submit/advance/events 只翻译到 v2。
5. Supabase 会话或旧散列 API token 通过一次性 exchange 领取绑定 RunAgent 的短期 credential；新明文只返回一次，旧 token 随即撤销。
6. M5 再迁移冷的 completed 历史。旧 Observation 只导入为 `issued`、`provenance=legacy_import`、`deliveryConfidence=unknown`，绝不伪造 acknowledgement。
7. 调用量归零后关闭 v1 写端点，旧表保持只读。

## 最小 v2 walking slice

M2 交付固定场景的最小 create/join/start API。M3 用它启动永定河四角色 fixture；完整可视化场景编辑和人工导调命令留到后续管理里程碑。

验收结果必须是：四个不同 RunAgent 获得不同 Receipt、并行完成 Task、通过 Artifact/Message 汇流成团队 Submission，并分别得到个人、角色和团队 Feedback。

## 首批 Red 测试

### 并发与状态

- 不同 Task 并行提交不会冲突；一个 Task 的评价不会冻结其他 Task。
- 同一 Task 并发 claim 只有一个成功；租约过期后可重新 claim，旧 token 不能 heartbeat/submit。
- 多个 Task 同时完成时 Barrier 只释放一次。
- 事件 head 为并发事务分配连续、唯一的 `run_seq`，失败事务不留下状态/事件裂缝。
- 同幂等键与同 hash 返回原响应；同键不同 hash 返回 409。
- Artifact 的旧 `baseVersionId` 产生显式分支或稳定冲突，不覆盖并发工件。

### 身份、版本与权限

- 同一个 RunAgent 占多个角色不能满足必需角色 quorum。
- ScenarioVersion/AgentVersion 发布后正文不可修改；retire 只追加 lifecycle event。
- credential 过期、撤销或轮换后旧 token 立即失败；身份 revoke 同时移除活跃 RunAgent。
- 公共场景 API 无法读取或推断草稿、校验错误和 readiness。
- 角色 Feedback 只对发放时收件人快照可见；`feedback_action_grant` 不可跨 Agent/Task、过期或超次数使用。

### `/sync` 与回放

- 同一个 `/sync` 幂等请求返回原 delivery batch，不重复生成 Receipt。
- GET tasks/messages/artifacts/feedback 只恢复已发放内容，不把 eligible 内容变成 issued。
- acknowledgement 的 chain head 或序号错误时拒绝；Receipt 永不回写。
- 同一 `run_seq` 的 operator、team、role 和 agent projection 正确不同。
- Agent A 的回放不出现 B 的私有 Receipt payload、Submission、Feedback 或 Tool 内容。

### Telemetry

- 未集成 exporter 时只显示 EXCON 边界 Span，不伪造 Agent 内部过程。
- participant exporter 不能冒充其他 Agent 或平台服务；其 Span 标为 `participant_reported`。
- 自报 Span 不能改变权限、Barrier、得分或审计事实。
- 删除全部 Telemetry 后，Event/Receipt 回放仍完整。

完整设计与更多失败注入见仓库 `docs/design/v2-multi-scenario-multi-agent-observability.md`。
