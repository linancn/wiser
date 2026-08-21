---
title: 安全与数据边界
description: 防止事实泄露、越权观察、凭据扩散和不可审计修改。
docType: security-guide
scope: agent-excon-v2
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改身份、RLS、秘密数据或审计边界时
whenToUpdate:
  - 授权、数据库安全或凭据策略变化时
checkPaths:
  - supabase/**
  - apps/api/**
  - apps/telemetry-ingress/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

## 四类数据必须分开

| 数据层     | 示例                                           | 访问主体                     |
| ---------- | ---------------------------------------------- | ---------------------------- |
| Agent 视图 | 已发放 Receipt、本人 Task 和定向 Feedback      | 固定收件人快照中的 RunAgent  |
| 团队共享   | 已发布 Message、ArtifactVersion、团队 Feedback | 发布时的团队/角色收件人快照  |
| 受限状态   | 未释放 Inject、他人私有 Trace、内部阶段条件    | 导调领域服务、授权管理员     |
| 事实与裁决 | Outcome、隐藏标签、完整评价规则                | Worker、裁决服务、授权评审者 |

浏览器和参训智能体永远不能接收完整事实对象，再依赖前端隐藏字段。服务端必须从查询源头隔离数据。

## Supabase 与 RLS

- Supabase Auth 是全 WISER 唯一的用户、Session、Tenant、Project、Membership 与委托身份权威；Data Foundation 不创建第二套 Auth。
- `platform` 与 `platform_private` 不暴露给 Data API，默认撤销 anon/authenticated 的 Schema、Table、Sequence 和 Function 权限，并对所有表启用 `FORCE ROW LEVEL SECURITY` 作为纵深防御。
- 所有暴露 schema 的表启用 RLS。
- 新表不会天然暴露给 Data API；`GRANT` 和 RLS 是两个独立步骤。
- 策略使用 `TO authenticated` 加所有权、RunAgent 和 recipient snapshot 谓词，不能只验证角色。
- `UPDATE` 同时配置 `USING` 和 `WITH CHECK`，并提供需要的 `SELECT` policy。
- 授权数据放在 `app_metadata`，不能使用用户可修改的 `user_metadata`。
- 前端只使用 publishable key；secret/service-role key 仅限服务端。
- View 使用 `security_invoker`，特权函数放入未暴露 schema 并撤销默认 `PUBLIC EXECUTE`。

每次 migration 后运行数据库安全 advisor，并以真实 `anon`、`authenticated` 和服务角色分别做集成测试。

## 时间与证据授权

`Observation` 是 v1 兼容协议术语。v2 不再创建独立 Observation 实体：系统判断 RunAgent 在当前虚拟时间有权访问后，由 `/sync` 把实际发放的 Inject payload 固化为 `AgentViewReceipt`。提交引用证据时，必须验证 Receipt 属于该 RunAgent，或引用的是已经显式授权给它的 ArtifactVersion。

这条约束同时阻止越权访问和历史回放中的时间穿越。

团队/角色消息不能按“当前成员”动态查询历史可见性。发送时必须固定收件人快照；后来加入的 Agent 只有在出现新的 disclosure Receipt 后才能读取旧内容。

## OTel 与隐藏内容

OpenTelemetry 是可采样的诊断投影，不是权限边界。默认不采集 prompt、completion、Tool 参数/结果、隐藏 Outcome、Submission/Feedback 正文、个人信息或思维链。Span/Log 只保留安全 ID、分类、模型、token、时延、状态和授权后的摘要引用。

WISER Web 只接收 Observability Gateway 产生的安全 DTO，不直接读取 Tempo、Loki 或原始 OTLP。参训者也不能直连 Collector；认证 Ingress 绑定 RunAgent、覆盖客户端身份属性并标记 `participant_reported`。这类自报 Span 不能改变权限、Barrier、得分或审计事实。Telemetry 缺失必须显示“未观测”，不能推断 Agent 没有执行。

## Codex 和 API 凭据

- 本机 Codex 登录只用于开发者宿主机。
- 不把 `~/.codex`、访问 token 或 API key 烘焙进镜像、挂载到共享容器或写入事件 payload。
- CI 使用 fake provider；显式的在线测试使用最小权限 secret。
- 日志记录供应商、模型、耗时和 token 数，不记录原始凭据。
- 用户上传和模型输出都视为不可信内容，不能当成系统指令执行。

## Compose 安全

官方 Supabase 镜像作为一个版本集合锁定；使用 Envoy 当前配置，不复用旧 Kong 配置。真实 `.env` 不提交 Git。数据库和 Studio 默认只绑定本机或受控网络，公开部署必须增加 TLS、备份、密钥轮换和网络策略。

普通 `docker compose down` 保留数据；删除卷必须由操作者显式确认。

## 发布前检查

- [ ] 未释放的 Inject 无法通过 API、日志或错误详情推断。
- [ ] Agent A 的回放、Trace 和日志不包含 Agent B 的私有 Receipt、提交或反馈。
- [ ] 新加入角色不会自动获得历史消息；回填有明确 disclosure Receipt。
- [ ] 幂等重试不会重复创建提交或评价。
- [ ] 事实、规则和人工覆盖均有 actor、版本与领域 event ID；trace ID 只作为可选关联。
- [ ] OTLP 中没有 prompt、Tool 正文、隐藏 Outcome、私有反馈或凭据。
- [ ] 参训者不能冒充其他 RunAgent 或平台服务；自报 Span 不参与裁决。
- [ ] 下载链接短期有效并绑定对象权限。
- [ ] RLS、SQL 事务和状态机负向测试在真实 PostgreSQL 上通过。
- [ ] 在线 AI 测试不是合并请求的必需条件。
