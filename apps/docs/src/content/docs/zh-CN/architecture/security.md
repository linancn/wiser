---
title: 安全与数据边界
description: 防止事实泄露、越权观察、凭据扩散和不可审计修改。
docType: security-guide
scope: wiser-security
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
  - apps/web/**
  - apps/mcp/**
  - apps/data-worker/**
  - apps/telemetry-ingress/**
  - packages/platform-auth/**
  - packages/data-infra/**
  - infrastructure/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: ce7c39fbcc4aebc5bca1f67ee80634b7ce544c4d
---

## 四类数据必须分开

本页覆盖 WISER 平台级身份、数据库、秘密和遥测边界；下表先列 Agent EXCON 的可见性分层，Data Foundation 仍遵守后续相同的服务端隔离、RLS 与最小权限规则。

| 数据层     | 示例                                           | 访问主体                     |
| ---------- | ---------------------------------------------- | ---------------------------- |
| Agent 视图 | 已发放 Receipt、本人 Task 和定向 Feedback      | 固定收件人快照中的 RunAgent  |
| 团队共享   | 已发布 Message、ArtifactVersion、团队 Feedback | 发布时的团队/角色收件人快照  |
| 受限状态   | 未释放 Inject、他人私有 Trace、内部阶段条件    | 导调领域服务、授权管理员     |
| 事实与裁决 | Outcome、隐藏标签、完整评价规则                | Worker、裁决服务、授权评审者 |

浏览器和参训智能体永远不能接收完整事实对象，再依赖前端隐藏字段。服务端必须从查询源头隔离数据。

## Supabase 与 RLS

通过 `[auth] enable_signup=false` 和现网 `GOTRUE_DISABLE_SIGNUP=true` 关闭公众自行注册，已有账户的邮箱认证保持开启。账户开通与邀请须经授权的维护流程；创建账户本身不授予项目成员权限。

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

带有 `client_id` 的 OAuth resource Token 不继承 human 直接访问权限。普通 API JWT 验证器会拒绝这类 Token；暴露的应用表在所有权策略之外叠加 restrictive `wiser_direct_session_only` 策略，新增暴露表时也必须保留该限制。Agent 连接与 OAuth credential 绑定存放在强制 RLS 的私有表；token hook 仅向 Supabase Auth 授予必要的读取和执行权限。

OAuth 交换 credential 必须保留不可变的 `agent_exchange` 类型与 Session 绑定；延迟数据库约束会拒绝未绑定的签发。API 每次使用时都检查该绑定，包括 OAuth consent/client 撤销与 Session 删除，因此撤销不依赖等待短期凭证到期。查询授权不包含入库与发布，入库授权也不包含发布。

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

认证 URL 中的邀请 hash、OAuth 授权码与令牌同样不得写入访问日志。Web 通过 `logging: false` 关闭 Next.js 开发请求日志；自托管 Kong 应持久配置 `KONG_PROXY_ACCESS_LOG=off`、`KONG_ADMIN_ACCESS_LOG=off`，或使用已审查且排除查询参数值的日志格式。路由器日志与错误报告也不得记录认证 URL。发送有效邀请前，用无敏感信息的测试标记逐层核验 stdout 与 stderr，不要用真实凭据测试日志。

## Compose 安全

Supabase 镜像作为一个兼容版本集合锁定，gateway 配置与该集合一起验证。真实 `.env` 不提交 Git。数据库和 Studio 默认只绑定本机或受控网络，公开部署必须增加 TLS、备份、密钥轮换和网络策略。

普通 `docker compose down` 保留数据；删除卷必须由操作者显式确认。

## 安全验证清单

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

## 项目访问控制记录

`04_project_access.sql` 与 CLI 生成的迁移新增私有、强制 RLS 的项目设置、可分配角色、邀请、幂等回执及不可变成员事件，不为浏览器或 service-role 增加直读权限。项目发现默认关闭。这些记录属于控制面，不另建身份库，也不进入 Data Foundation 迁移历史。`WISER_ACCESS_TEST_DATABASE_URL` 集成套件仅可连接已迁移并加载 seed 的可丢弃 Supabase 测试库；先运行 pgTAP，再加入集成测试身份。不得重置现有开发或共享实例。

访问申请同样保存在私有、强制RLS的控制面。审批人与申请人独立，批准本身不等于授权。执行时重新检查审批人权限、角色策略与成员版本；撤回、到期及撤权保留不可改写的审计回执。

## 固定版本资源授权

`05_resource_access.sql` 增加私有、强制RLS的项目配置、固定版本资源包与预设、授权、独立撤销记录及审计事件。既有项目未显式配置时保留原规则；种子不启用受管理模式、不自动发出资源授权。配置不能通过删除恢复为旧宽权限。变更推进项目资源修订号，资料包动作上限与预设期限在数据库内约束授权，资源和策略始终引用固定版本。浏览器与通用服务角色没有直接表权限。新增pgTAP及完整重置、lint、advisor仅对可丢弃实例执行。真实用户启用前还须完成业务API、供方上限及Data各出口的执行检查。

## 有界资源批量办理存储

`06_resource_batches.sql`在私有控制面保存固定版本的批次快照、最多50位明确编号的成员、逐人追加办理回执及重要审批岗位配置。待批记录不产生授权；状态变化必须递增版本。申请人及受益成员不能批准自己的批次，批准后不得新增成员或修改用途、期限。成功回执必须指向与批准资料包、预设版本及成员一致的授权，同一成员不能重复成功执行。迁移不指定审批人，也不生成申请。运行时仍须核验当前岗位、成员、供方许可与Data有效性，不能仅凭存储约束声称批量流程已开放。

来源许可流程存储（`20260923065331_resource_policy_administration.sql`）增加明确的项目办理/审批岗位配置及不可改写的申请。迁移默认不授予岗位或来源许可。申请从待审批开始，状态变化须递增版本，提交依据保留，不允许删除或在终态后重开。发布回执必须对应内容、申请人和独立审批人均一致的不可变许可版本。撤回不产生权限。两张表均强制RLS，匿名、登录用户和通用服务角色不能直接访问。岗位配置仍属受控维护操作；运行时鉴权、HTTP和页面验收与本次存储验证分开。
