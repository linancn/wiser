---
title: 统一身份与授权
description: WISER 各系统当前的登录、项目权限、智能体授权及统一身份规则。
docType: security-guide
scope: wiser-auth
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改登录、JWT、Session、租户、项目、Role、Scope 或 Agent 委托时
whenToUpdate:
  - 身份源、Membership、RLS、凭据或撤权语义变化时
checkPaths:
  - supabase/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/telemetry-ingress/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

## 从哪里获得访问权限

| 任务           | 当前入口                                        | 权限依据                                                         |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| 了解 WISER     | Portal 公开                                     | 阅读系统介绍无需账号                                             |
| 进入工作区     | 使用已有组织账号登录                            | 需要已验证的会话和当前项目成员资格                               |
| 查阅或管理资料 | 在数据基座选择获准项目                          | 按操作核对成员资格、资料授权、来源条款及用途                     |
| 参与演练       | 打开获准的智能体演练场景或运行                  | 账号需要相应的演练角色与权限                                     |
| 连接外部智能体 | 从兼容的 MCP 客户端发起 OAuth，在浏览器确认授权 | 本人选择项目、用途、数据等级和有效期；网页权限不会自动授予智能体 |

已核验的现网服务关闭了公开自行注册；账号创建和项目成员资格由管理员办理。[现网资料指南](/development/wiser-data-guide/)说明当前入口及尚待完成的个人客户端验收。本页解释这些用户路径背后的统一身份约束。

## 单一身份源

全 WISER 只使用现有 Supabase Auth、JWT signing keys/JWKS、Session 和 PostgreSQL 控制面。Data Foundation 的独立 data-postgres 不创建用户、Membership、Role 或 Token 权威表。

JWT 证明主体、认证强度与 Session；动态 Tenant、Project、Role 和 Scope 从 Supabase 控制面解析。`user_metadata` 可由用户修改，绝不参与授权；动态权限也不完整复制进 JWT，因为 claims 只有刷新 Token 后才变化。

控制面包含 `platform` / `platform_private` Schema、用户自动建档、Tenant/Project/Membership、Role/Scope/Binding、Delegation、私有 Credential/Audit/Outbox、最小权限与 pgTAP 契约。默认 Supabase runtime 组合框架无关的 `SupabaseJwtPrincipalResolver`、`getClaims` 结果验证器、单查询 PostgreSQL Membership loader，以及委托 credential 签发/轮换/撤销流程；任何必要事实或配置缺失都 fail closed。

Fastify 提供 `/api/platform/v1/me` 安全投影与委托命令面。`WISER_AUTH_MODE=supabase` 在默认进程中创建 `supabase-js` client、受限 PostgreSQL Pool、按前缀分流的 JWT/delegated Resolver 与事务 Delegation service；生产缺少 Supabase、数据库或 HMAC key ring 配置时拒绝启动，进程关闭时释放共享 Pool。

Web 使用 `@supabase/ssr` 建立 Browser/Server Client 与 Next.js `proxy.ts`。Proxy 在响应产生前调用 `getClaims()`，刷新后的 Cookie 同时写回 request/response，并设置 `private, no-store`。`/[locale]` Portal、登录与 Auth transport 允许匿名访问；其他 locale 产品路由缺少已验证 authenticated claims 时，Proxy 保留目标地址并跳到同语言登录页。双语密码登录、PKCE callback、仅 POST 的本地退出，以及共享 Shell 的当前 Session 状态使用同一 Session 边界。所有 continuation target 都被规范到当前语言；离开 WISER origin 或重新进入 Auth endpoint 的地址一律拒绝；所有 Auth 响应均不可缓存。

委托凭据严格解析 `wdc1.<key-id>.<secret>`，使用 Node 安全随机源分别生成 128-bit locator 与 256-bit secret，数据库只保存经过域隔离的 HMAC-SHA-256。JSON key ring 只接受至少 256-bit 的规范无填充 base64url key，指定一个 active key 负责新签发，同时保留旧 key 支持轮换期验证；任何配置错误都 fail closed，且不会回显秘密。delegated principal Resolver、PostgreSQL 单查询 adapter 与事务 create/issue/rotate/revoke service 都在默认进程 runtime 中组合。

## 受邀读者与本人设密

邀请继续使用既有 Supabase Auth 权威。`GET /[locale]/auth/invite?token_hash=...` 仅显示确认页，用户明确提交后才由 `POST /[locale]/auth/accept` 消费邀请。服务端只接受 invite 类型，核对同源 Origin 与新的已认证 claims，然后移除 hash 跳转到 `/[locale]/account/password`。邮件扫描或仅打开落地页不会消耗邀请；失效、过期与重复使用显示统一的恢复提示，不暴露上游错误。

由已有获授权管理员配置 Supabase 的**邀请邮件模板**，指向已部署的 HTTPS WISER `/zh-CN/auth/invite?token_hash={{ .TokenHash }}`，英文使用 `/en/auth/invite`。默认携带 fragment 的邀请链接不能直接交给仅处理 PKCE 的旧回调，因为邀请人与接收人并不共享 PKCE 校验器；原 PKCE 登录流程保留。部署时须从访问日志、分析与错误报告中移除 `token_hash` 等认证查询值，不把真实邀请链接放入工单。邀请和设密页面使用 `strict-origin`，原生表单保留可核验的 Origin，Referer 只含站点来源、不含路径或令牌；接受/设密响应仍使用 no-referrer 且不缓存。文档级 no-referrer 会把原生表单 Origin 变为 null，不能为此放宽同源检查；单次邀请链接在使用或过期前仍属于凭据。

已登录用户可从账户区进入设密页。`POST /[locale]/auth/password` 核对同源 Origin、已验证 claims 与实时 `getUser()` 的同一身份，要求两次密码一致且为12–4096个字符，仅调用 Supabase `updateUser({password})`，提供方密码和安全要求仍生效。成功后退出本地会话再登录，不宣称同时撤销其他设备会话。不使用管理密钥、不操作成员或角色、不新增公开注册或管理员后台。设密不会授予租户、项目或资料权限；这些继续由管理员通过既有控制面另行管理。

本地验收使用隔离合成身份，不发送真实邀请邮件。真实邮件投递、部署后的邀请模板、代理 Origin、目标成员授权及接收人本人体验仍需单独获授权验收。

邀请模板的唯一原件位于 `apps/web/public/auth-email-templates/invite.html`，由 Web 的 `/auth-email-templates/invite.html` 提供。Supabase CLI 通过 `[auth.email.template.invite]` 读取同一文件；Compose 管理的 GoTrue 则须将 `GOTRUE_MAILER_TEMPLATES_INVITE` 指向部署后的 HTTPS 模板地址。仅挂载文件不会生效，GoTrue 通过 HTTP 获取模板；获取失败可能回退默认邮件，因此须核对模板正文及实际生成的邀请链接。

## 控制面模型

```text
platform.actors
platform.user_profiles
platform.tenants
platform.tenant_memberships
platform.projects
platform.project_memberships
platform.roles
platform.role_scopes
platform.role_bindings
platform.delegations

platform_private.delegated_credentials
platform_private.authorization_audit_events
platform_private.control_outbox
platform_private.agent_connections
platform_private.agent_exchange_credentials
```

Agent 连接记录把一个 human 与 OAuth client 绑定到已有的 `agent-data` Delegation 和精确的 MCP resource URL。交换所得 credential 保留不可变的 OAuth Session 绑定，有效期不能超过 OAuth Token。可选的 Supabase access-token hook 保留直接登录的 claims，拒绝未授权 OAuth client，并把已批准 claims 绑定到对应 resource 与 Delegation。只有 Supabase Auth 可以调用该 hook；创建函数本身不会启用 OAuth runtime。普通 human JWT 解析会拒绝带有 `client_id` 的 Token。

`createSupabaseAgentClaimsVerifier` 单独验证这类已签名 claims：要求配置的精确 issuer、单一 resource audience、authenticated role、有效的 user/session/client/Delegation ID，以及未到期的整数 expiry。它不会从用户 metadata 推导 Delegation。claims 验证之后，调用方仍须检查实时连接与 Session 授权。

`PostgresAgentConnectionService` 提供请求检查、项目授权、连接列表与撤销，以及 credential 交换。授权要求实时有效的直接 human Session、`platform.delegation.manage`，以及目标 Project 的目录读取权限。查询模式仅授予调用方已有的读取 scopes；入库还要求用户明确选择且当前具备 `data.ingestion.write`，不授予发布权限。安全等级默认内部，不能超过调用方上限；授权有效期为 60–3600 秒。浏览器须先通过 Supabase 把 OAuth authorization request 关联到 human，再由服务提交授权。

授权在一个控制面事务内创建平台 Agent、到期 Membership 与有边界的 Delegation。重新授权会撤销旧 Delegation。交换流程检查当前连接、OAuth client、consent 与 Session，再签发最长 60 秒且不超过 OAuth 和 Delegation 到期时间的 credential。`agent_exchange` credential 支持并发请求；普通 `delegated` credential 保留单枚有效约束。credential 类型和 OAuth 绑定不可变，延迟约束要求提交时绑定必须存在；每次委托 API 解析都会复查绑定的 Session、consent、client 和当前 Delegation。变更使用幂等锁与原子 Audit/Outbox，交换重放不能恢复明文。

- Actor 统一表示 human、agent 与 service；human actor 关联 `auth.users.id`。
- Tenant 是顶级隔离边界；Project 是业务资源所有权边界。
- Tenant Membership 不自动授予任意 Project 数据访问。
- Role 与 Scope 分开建模；Scope 使用 `platform.*`、`excon.*`、`data.*` 命名空间。每个 Role 还带 fail-closed 的 L0–L3 安全等级 ceiling；实时授权上下文取调用方 active bindings 中的最高 ceiling。
- 所有暴露表启用 RLS，并同时使用主体、Tenant、Project 和所有权谓词；`TO authenticated` 本身不构成授权。
- 特权函数进入未暴露 schema，固定安全 `search_path`，撤销默认 `PUBLIC EXECUTE`。

## Platform HTTP 入口

| 方法   | 路径                                                             | 作用                                                             |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/platform/v1/me`                                            | 返回安全的 Actor、Role、Scope、security ceiling 与 authz version |
| `POST` | `/api/platform/v1/delegations`                                   | 创建有边界的 Delegation                                          |
| `GET`  | `/api/platform/v1/delegations/{delegationId}`                    | 读取安全 metadata                                                |
| `POST` | `/api/platform/v1/delegations/{delegationId}/credentials`        | 签发一次性明文 credential                                        |
| `POST` | `/api/platform/v1/delegations/{delegationId}/credentials:rotate` | 轮换并一次性返回新明文                                           |
| `POST` | `/api/platform/v1/delegations/{delegationId}:revoke`             | 撤销 Delegation                                                  |
| `POST` | `/api/platform/v1/credentials/{credentialId}:revoke`             | 撤销单个 credential                                              |

`/me` 与委托路由都要求 Bearer、Tenant、Project 与 Purpose。所有写操作要求 UUID `Idempotency-Key`；Delegation 命令还要求经过验证且具备 `platform.delegation.manage` 的 Supabase human。响应为 `private, no-store`，issue/rotate 的明文不可恢复。

API 同时配置 `WISER_AGENT_MCP_RESOURCE`（精确的公开 `/mcp` URL）与 `WISER_AGENT_AUTH_ISSUER`（公开 Supabase `/auth/v1` issuer）后启用 Agent HTTP 路由。除回环地址外，两者都要求 HTTPS。内部 Supabase transport URL 与公开 issuer 分开配置；配置不完整时拒绝启动。

| 方法   | 路径                                                       | 认证与结果                                                         |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`  | `/api/platform/v1/agent-authorizations/{authorizationId}`  | 直接 human Session；OAuth client 信息与可授权项目                  |
| `POST` | `/api/platform/v1/agent-connections`                       | 直接 human Session；有边界的项目授权                               |
| `GET`  | `/api/platform/v1/agent-connections`                       | 直接 human Session；自己的安全连接 metadata                        |
| `POST` | `/api/platform/v1/agent-connections/{connectionId}/revoke` | 直接 human Session；撤销自己的连接                                 |
| `POST` | `/api/platform/v1/agent-connections/exchange`              | 绑定 resource 的 OAuth Token；短期 credential 与服务端绑定的上下文 |

这些路由通过经过验证的 Session、持久化授权或 OAuth 绑定确定项目所有权。交换与撤销仅接受空 JSON body；所有写操作要求 UUID `Idempotency-Key`。入口统一校验输入和输出 schema，限制请求 body 为 16 KiB，并返回 no-store 响应和受控错误。数据库或 provider 故障不会暴露上游细节，管理视图不返回 credential。

### 7100 公网 OAuth 部署

当前部署启用了 GoTrue OAuth 2.1、动态客户端注册与 `platform_private.agent_access_token_hook`。Web 的 `/oauth/consent` 把授权请求送到已登录的双语页面；页面先通过 Supabase 关联当前 human，再从 WISER API 读取可授权项目。用户必须明确选择一个项目、模式、级别和期限，或拒绝。项目授权先提交，随后 Supabase 才批准授权码。MCP 发现元数据中的 resource 为 `https://mcp.wiser.thuenv.tiangong.world:7100/mcp`，issuer 为 `https://auth.wiser.thuenv.tiangong.world:7100/auth/v1`。Auth 反代只允许 `/auth/v1` 和精确的 `/.well-known/oauth-authorization-server/auth/v1`；后者在反代内改写到 Kong 的 Auth 路由，不开放 Kong 的 REST/Storage。

截至 2026-09-26，现有合成普通身份已通过公网浏览器同意／拒绝、PKCE 交换及官方 MCP SDK 实际调用，包含受管资料范围、跨项目拒绝、撤销和真实时钟到期。本人的真实客户端验收由用户明确推迟，仍为 **BLOCKED**；合成协议证据不能替代本人验收。详见资料指南中的范围与收据说明。公众自行注册已关闭：现网认证 API 返回 `disable_signup=true`，公众注册请求得到 `signup_disabled`。已有邮箱密码登录保持开启；管理员邀请仍须分别验证邮件投递与收件人接受。

## 请求处理

```text
Bearer credential
→ Supabase JWT / delegated / local Resolver
→ 验证签名、issuer、audience、expiry、session 或 delegation
→ 查询 Supabase Membership/Role/Scope
→ PlatformPrincipal + AuthorizedContext（包含 maxSecurityLevel）
→ AuthorizationService(capability, purpose, resource, security level, fields, volume)
→ 系统 Handler
→ append-only 审计
```

JWT 失败后不得回退到 Local Token，防止 token confusion。Local Token 只允许在明确的 development/test 模式使用，生产环境检测到该配置必须拒绝启动。

## Web Session

Web 使用 Supabase SSR Cookie。Server Component 转发当前 Access Token，Fastify 再次验证并授权。浏览器只获得 Supabase URL 与 publishable key；service role、secret key、数据库连接、对象存储密钥和内部投影凭据均不得进入客户端。

公开 Portal 只展示平台和系统介绍，不读取项目、数据或演练事实。Proxy 登录门禁只建立“已有有效 Session”的最低边界，不能替代 Data Capability、EXCON operator 或具体资源的服务端授权。`WISER_AUTH_MODE=off` 只允许显式本机 reference 预览，生产环境拒绝该模式。

Shell 的用户状态只来自刚完成验证的 authenticated claims，不把用户可编辑 metadata 渲染成可信 Role 或管理员标签。Claims 无效、过期、带特权角色、服务不可用或格式畸形时，一律进入匿名/fail-closed 状态。

Data 与 EXCON 交互式读取共用服务端 Session verifier：先验证未过期的 authenticated claims，再读取当前 Access Token，并要求其主体、Session、Role 和到期时间与已验证 claims 一致。Session 无效或错配时绝不回退到 `WISER_WEB_OPERATOR_TOKEN`；该 operator/service identity 仅用于显式关闭 Auth 的本机开发。生产 EXCON 读取使用当前登录用户并由 API 再次授权。

## Agent 与 MCP 委托

经验证且具备 `platform.delegation.manage` 的 Supabase human 通过授权 API 为具体 Agent/Run/Project 签发短期 delegated credential。请求 Scope 与委托人实时 Scope 求交集，Purpose、安全等级上限和有效期固化在 Delegation 中。

- 委托链最大深度为一。
- 明文 credential 只返回一次；数据库保存带服务器 Pepper 的 HMAC。
- 委托 Bearer Token 固定使用 `wdc1.<key-id>.<secret>` 封装；公开 key id 只定位私有记录，`hmac_key_id` 选择可轮换的服务端密钥且不会暴露密钥本身。
- 验证时只用公开 key id 定位记录，在进程内重算 HMAC 并执行固定长度的 timing-safe 比较；未知 key、畸形 Token 与 HMAC 不匹配使用同一失败表面。
- Delegation 带乐观版本；撤销和轮换保留旧 Credential 安全事实，删除 Tenant、Project 或 Delegation 不得级联擦除历史。
- 撤销委托人 Membership、Project、Agent、Delegation 或 credential 后，下一次请求失败。
- MCP Tool 参数、Message、Artifact、日志与 Trace 不得包含凭据。
- Platform delegated credential 位于 `platform_private.delegated_credentials`，使用 `wdc1.` envelope。EXCON 另有 `excon_private.run_agent_credentials` opaque capability token，直接绑定 `runAgentId/runId` 与协议 Scope；两者不是同一行或同一种 token。

Telemetry Ingress 不签发新身份；它验证上述独立 EXCON RunAgent capability token 的 HMAC，并要求协议级 `telemetry:write` scope、未过期/未撤销 credential、有效 RunAgent、AgentVersion 与 AgentIdentity 生命周期。该 verifier **不会**重新解析 Platform `wdc1.` Delegation、Tenant/Project Membership 或其撤销状态；撤销平台 Membership 不会单独使 telemetry token 失效。仓库尚未提供此 token 的签发/轮换/撤销 API/CLI，生产部署必须提供并测试受信任 lifecycle workflow，否则数据库模式不能视为可运营完成。

Fastify `platform.delegation` 模块定义 create、metadata read、issue、rotate 与 revoke 的 HTTP 命令边界。只有通过验证且拥有 `platform.delegation.manage` 的 Supabase human 才能调用；命令必须使用 UUID 幂等键，TTL 最长一小时，委托 Scope 必须已知，ceiling 不得高于调用方实时上限。明文只出现在成功的 issue/rotate 响应中，所有响应均为 `private, no-store`。`PostgresPlatformDelegationService` 在每个事务内重验 Supabase Session 与实时 Membership，取得幂等锁和 aggregate 行锁，把 credential 有效期裁剪到 15 分钟与 Delegation expiry 中较早者，保证单 active credential，并原子写 Audit 与 Control Outbox。同 hash 命令可安全重放；issue/rotate 重放返回 `SECRET_NOT_RECOVERABLE`，不会保存可恢复明文。Audit、Outbox 与错误中均不含 Token/HMAC。

Delegated Bearer 解析会在任何数据库查询前校验封装格式，再按公开 key id 加载一条私有记录，在 Node 内执行固定长度 timing-safe HMAC 比较，之后才信任控制事实。每个请求都实时复核双方 Actor、双方 Tenant/Project Membership、Tenant、Project、Delegation/Credential 生命周期、Purpose 与 expiry。有效 Scope 是委托 Scope、委托人实时 Scope 与注入的 known-scope registry 的有序交集；有效安全 ceiling 取 Delegation 与委托人当前 ceiling 中较低者。授权解析不使用正向缓存。

Agent EXCON v2 participant authenticator 与 Data Capability Handler 复用同一个 prefix-routed Platform Resolver。完整栈给 EXCON 注入固定 Tenant/Project/Purpose，并要求 delegated principal 的 `runAgentIds`/Scope 与请求资源一致；Data REST、GraphQL、MCP 和 Web server DAL 都用同一 Supabase JWT 或 `wdc1.` credential 解析实时上下文。EXCON command journal 和 data-postgres 只保存 scoped subject reference/audit，不创建第二套身份系统。

## Data Foundation 跨库引用

data-postgres 只保存 Tenant、Project、Actor UUID 与策略版本，不复制 Supabase Session 或秘密。只读 `control_ref` 可帮助后台一致性检查，但绝不扩大权限。查询、下载、导出、审核和发布前，API 必须用 Supabase 权威上下文再次授权。

## 必测失败路径

- 错误签名、issuer、audience、过期、未生效、未知 key、错误 Session。
- 跨 Tenant/Project 替换 ID、Header 或资源引用。
- 已撤销 Membership、Delegation、Credential、Agent 或 Project。
- 越权 Scope、Purpose、安全等级、字段或导出量。
- RLS 对 anon、authenticated、API、Worker 和迁移角色的隔离。
- 浏览器、MCP、日志和 Telemetry 中不存在任何服务器秘密。

## 项目管理授权规则边界

纯函数形式的项目授权规则区分`platform.membership.manage`与`platform.access.approve`。项目管理或资料读取权限本身不代表转授权权。授予角色必须有明确的可分配角色配置，角色为有效的普通业务角色，期限有界且不超过配置及管理员有效权限期限，安全等级不高于管理员。含平台权限的角色不能通过该流程分配。禁止给自己授权或自行批准；普通成员撤销操作不能移除管理岗位，其变更仍由受控维护流程办理，同时保护最后一个管理员和其他管理岗位。

此规则是实现基础，尚不代表新增管理接口已经部署。传输与持久化层仍须验证实时直接人类Session，在事务内重新加载当前项目授权，并处理并发、重试和审计。规则不读取用户可编辑metadata、不新建身份源、不授予资料级下载权限，也不改变既有Data鉴权。

## 项目成员 API

应用 Supabase 项目访问迁移后，显式设置 `WISER_PROJECT_ACCESS_ENABLED=true` 才注册 `/api/platform/v1/access/projects`、该前缀下的 `/projects/:projectId/members`，以及 POST `/grants`、`/revocations`。默认关闭，原入口不变。每次操作重新验证真人 Session、项目权限和可分配角色；service-role 与代理委托不能充当真人管理员。分页最多50条，拒绝未知命令字段，响应只返回声明字段且禁止缓存。

私有项目策略限定可分配角色和最长天数；开发 seed 配置本地管理员 scope 与 data-reader 策略，但默认不开放项目发现。迁移不会自动给现有部署增加管理员或开放项目。普通成员入口禁止改自己的权限，也不能借新增成员激活既有租户管理角色。成员期限约束该项目内全部角色的使用；撤权保留 Auth 账号和租户成员，只撤销指定项目及其角色绑定，重新激活不会复活其他旧授权。

事务内串行锁定项目、比较成员版本、核对幂等键和内容哈希，推进有效授权版本，并一起写入成员历史、既有授权审计和 Control Outbox。重放返回原命令回执，页面须再查询当前成员状态，不能把旧回执当作当前有效权限。审计与幂等记录不可改写。邀请投递见下节；独立申请审批见下节。

受信主机维护入口 `apps/api/src/platform/project-access-bootstrap-cli.ts` 根据私有 JSON 配置初始化隔离权限演示项目和另一个保持旧资料模式的试录入项目。先执行 `--dry-run`；它会在完整事务回滚前核对当前维护权限、前三个临时账号的原只读绑定、岗位定义、期限和数据库约束。`--apply` 才提交相同范围的配置，同时追加成员事件、授权审计和 Control Outbox。五个临时账号在原项目的绑定保持不变；仅前三个在演示项目获得最长七天的分开岗位。研究者在原项目取得专用查阅／委托岗位，在独立试录入项目取得提交／任务查阅岗位，不含发布、审批或成员管理 scope。此流程不创建受管资料设置。以同一配置重跑只核对既有状态，不延长期限；变更需求须重新审阅配置或通过受信维护事务撤权，不删除审计历史，也不靠启用原项目受管模式恢复访问。

## 项目访问工作区

Web和API同时启用上述开关后，从“账户”打开 `/[locale]/account/access`。页面要求刚刚核验的真人Session。“我的访问”显示本人的有效角色和成员期限；仅有active成员记录而无有效角色时，不表示能够访问。“成员与权限”仅向当前项目有管理权的人开放，支持受限搜索、分页、角色及期限调整和项目撤权。Web同源接口转发当前Session，写操作检查同源、JSON及体积上限，响应也有大小限制；不会回退到固定令牌或管理员凭据。写操作沿用固定幂等键及成员版本，提交后或权限失败时清除旧列表并重新查询。

`WISER_ACCESS_ENVIRONMENT=local`只标注维护者明确配置的本机演示，其余显示当前站点；它不选择数据库，也不跨环境同步账号。Web连接的Supabase实例与内部API必须属于同一套演示环境。“账户”折叠菜单同时保留本人密码和退出操作，支持键盘并避免在窄屏挤占主导航。

真实会话浏览器验收使用 `apps/web/playwright.access.config.ts`，必须显式指定loopback预览地址。从受忽略env提供 `WISER_ACCESS_E2E_` 对应地址、管理员/查阅者邮箱及密码、项目ID；只使用可丢弃合成成员，检查会修改期限并撤销查阅者。含登录操作的检查不保存trace、截图或录屏。普通参考页面测试跳过这套独立真实Auth用例，跳过不算真实权限验收。

## 可恢复的项目邀请

管理员通过 `POST /api/platform/v1/access/invitations` 登记邀请，再明确调用 `POST /api/platform/v1/access/invitation-deliveries` 办理（命令均携带项目ID）；通过 `GET /api/platform/v1/access/projects/:projectId/invitations` 查询记录。列表受项目权限与分页限制且不缓存。页面提供邮箱、获准角色、期限、原因，以及刷新、重试和单独的账号接受状态。“授权办理完成”是历史回执；到期或撤销后的有效权限仍以当前成员及资源鉴权为准。

先应用 `20260922094832_project_access_invitation_delivery.sql`。发送要求同时开启项目访问能力与仅 API 使用的 `WISER_PROJECT_INVITATION_ENABLED=true`，配置服务端 `SUPABASE_SERVICE_ROLE_KEY` 和固定 `WISER_PROJECT_ACCESS_WEB_ORIGIN`（loopback 外必须 HTTPS）。将 Auth Site URL 指向对应 WISER 站点，并参考 `apps/web/public/auth-email-templates/invite.html` 配置邀请邮件；仓库不会悄悄改写既有邮件设置。真实人员邀请前另验 SMTP、代理 Origin 与日志脱敏，管理密钥不得交给浏览器。

登记先提交，再调用 Auth。投递前保存带版本的办理状态，外部请求八秒超时且不跟随跳转，返回后重新核对真人会话、项目权限、角色策略、期限及 Auth 身份与邮箱，再在事务内一起授权和记录审计/outbox。已确认的既有账号直接复用、不再发邀请邮件。失败不表示已授权或邮件送达；提供方超时可能是结果未知。明确重试时重读版本，处理中至少等待60秒才可重新办理；同一幂等操作不会重复发起投递，不承诺跨服务邮件绝对只发一次。授权失败也保留 Auth 账号。

接受状态从 Auth 邮箱确认事实读回，与投递、授权处理分开。本地测试邮箱走通不代表外网真实邮件验收。双语原生表单回归检查准确的非空 Origin 与仅站点来源的 Referer。

## 独立申请、审批与授权执行

邀请迁移之后应用 `20260922102329_project_access_requests.sql`。启用项目访问后，“我的访问”可以办理申请；只有当前项目具备 `platform.access.approve` 的真人才能打开“审批与记录”。审批 scope 不等于成员管理权。项目发现/申请设置与可分配普通角色仍需明确配置，迁移不会自动公开项目或提升既有用户。

API 在 `/api/platform/v1/access` 下提供项目范围 GET `/projects/:projectId/requests`、`/events`，以及 POST `/requests`、`/request-decisions`、`/request-withdrawals`、`/request-executions`。申请人从刚核验的真人会话取得；普通人只看自己的申请，审批人看获准项目的待办。审计要求项目管理或审批权。列表受分页、字段白名单及禁止缓存约束；命令不接受调用方额外提供的身份或权限字段。

提交申请不授权。独立审批人记录批准/拒绝及理由，再由作出该决定且仍有权限的审批人明确执行。执行时重验角色策略、期限、账号、租户与成员状态，并比较提交申请时的成员版本；实际授权、审计和 outbox 一起提交。页面把历史办理结果与当前权限分列，到期、撤销或条件改变不会冒充当前有效。禁止自己批准自己，过时决定、越权执行及角色提权均被拒绝。

执行失败保留限定原因和新版本。刷新后，暂时失败可在权限有效时重试；成员版本冲突不能覆盖他人后续变更。申请人可撤回待审、已批准但未执行、执行失败的申请，再发起新的独立审批，原审批人不再可用时也有恢复路径。已经生效的授权不能靠撤回取消，须由获授权管理员撤销项目成员。撤回/执行及批准/拒绝的并发通过事务、版本与操作者范围的幂等约束处理。

使用隔离的合成申请人、审批人和管理员，验证申请→批准但仍无权→执行→真实目录/原件/图谱/地图读取→同一未过期会话撤权后拒绝。已签发文件链接仍有自身有效期；新资源请求被拒绝不表示抹除了已下载副本。项目成员资格获批本身不产生资料级授权，也不代表专业知识审核、跨环境账号同步或受控计算。

## 固定资源授权判定

Platform contracts中的`ResourceAccessGrantSnapshot`绑定主体、租户、项目、用途、资源包与预设版本、精确资料版本或外部来源、动作、生效和到期时间。`evaluateResourceAccess`是附加的确定性限制，时间和当前权威事实由调用方明确传入。内容读取不隐含原件获取、导出或外部目录调用；撤销一项授权不撤销其他独立有效授权。结果列出命中授权和最早重验时间，畸形或重复的权威记录失败关闭。

运行时已在核验人类或委托身份后读取固定资源授权。启动前须应用控制面资源迁移及Data的0030迁移；缺少权威表或读取失败时拒绝访问。迁移本身不启用任何项目。每个受管项目仍须明确启用、具备当前来源许可，并在目标环境完成核验。明确的legacy模式保留既有门禁，managed模式要求匹配的有效授权。两种模式均继续检查会话、项目、scope、安全等级、资源与供方限制。不得接受浏览器自报的判定权威输入，也不能以有效期为由忽略实时撤权。

纯资源范围编译器按动作整理固定资源引用，对结果设置上限，并将委托授权与委托人的有效范围取交集。重新核验时点包含将来生效和到期边界；权威快照格式错误时拒绝生成范围。项目配置决定是否启用；没有配置的项目保留既有模式。

运行时资源范围身份解析器为已核验会话附加实时控制面范围，严格绑定主体、项目、用途及实际委托人，并为有效范围生成缓存隔离指纹。不缓存授权读取，权威读取失败时不回退。平台身份接口与其他业务系统的传输入口共用该解析器。

PostgreSQL资源授权读取器通过同一语句读取项目配置、固定资源包/预设版本、撤销记录及数据库时间，仅选择核验主体与委托人、当前项目和用途；有效授权超过上限时整体拒绝，不截断后返回部分权限。隔离集成用例核验既有模式兼容、资料包升级不扩权、用途/主体隔离与撤销即时读回。Data接收这一可信上下文，不接受调用方提交的授权。受管项目当前仅放行明确列出的资源感知能力；入库、操作状态、对账及维护命令在完成对象归属检查前拒绝执行。外部目录读取还须具备对应来源的external.directory授权及独立有效的供方许可。

## 资源定义管理

`PostgresResourceAdministrationService`在既有控制面保存不可变的资源包和权限预设版本。办理要求有效的直接人类会话和当前`platform.membership.manage`，锁定项目与资源修订，沿用主体范围的幂等命令记录。版本冲突不会覆盖历史定义；创建定义不授予任何访问权限。项目须已有资源策略配置，这些方法不会启用旧项目。

资源包创建须通过可信应用端口核验精确资源可见性及许可限制，最长等待五秒并支持取消。端口接收当前已核验身份上下文和独立、单次使用的管理凭据，不接受浏览器提交的授权权威。Data事实经应用端口核验，不跨控制库与Data库直接关联查询。办理人保留许可依据和原因。包含原件获取、结果导出或外部目录调用的预设必须使用重要事项审批，不能通过改名降为普通审批。回执与审计记录固定版本和新权限修订。定义管理的HTTP与页面已接通；批量审批和执行由独立的办理接口承接。

资源管理HTTP模块提供有界的最新版本列表及严格校验的资源包、预设创建命令，响应禁止共享缓存，写入必须提供幂等键。列表只包含包内资源数量和登记的许可依据，不返回完整资源成员清单。业务服务仅允许具有项目成员管理权限的有效真人会话使用，管理权不等于内容访问权。运行时通过可信的数据校验端口接通。

资源管理采用仅核验元数据的内部端口。Platform在控制面项目与权限设置锁内检查当前来源许可后，生成进程内、单次使用的办理凭据，绑定已核验的操作者与会话、租户、项目、用途、岗位、操作权限、密级、权限版本、精确资源及请求动作。凭据最长五秒有效，且不超过来源许可期限；序列化副本、变更请求和重复使用均在访问Data前拒绝。端口在独立只读事务中，以一次有界查询核验固定版本、发布状态、接收状态和来源授权说明，仅返回是否通过。其事务局部RLS范围仅包含指定版本，不修改个人授权，也不向正文、证据、原件或导出适配器传递连接及范围；租户、项目与密级限制继续生效。取消或超时结果均拒绝。该核验不要求、也不授予个人正文读取权。外部来源仍需独立注册端口；覆盖浏览仅限当前获准项目视图。

资源批次固定最多50名当前有效项目成员及资源包、预设版本。预览最长15分钟有效，不产生授权。审批要求独立的有效`platform.access.approve`主体，申请人及接收人不能自批；重要事项还须匹配已配置岗位。执行重新核对原审批会话与当前权限、定义版本、Data可用性，以及项目成员、租户成员、主体三项独立版本。逐人记录办理尝试，临时存储失败通过事务保存点隔离，重试跳过已成功人员。幂等键按主体隔离，换内容复用同一键会拒绝。已鉴权HTTP模块提供有界批次列表及预览、审批、执行和撤回操作。管理员与审批岗位可读取项目清单，普通成员不能查看他人批次；仅申请人可撤回待审请求。命令必须携带主体范围的幂等键，操作保留审计历史。账户工作区展示相同的审批与执行阶段。

每个批次明确选择 `web-console`（网页访问）或 `agent-data`（AI/MCP 访问），申请表、审批详情与授权记录均展示该用途。已有授权数量、差异和预览指纹只纳入所选用途；撤销其他用途的授权不使本次预览失效。续期保留原用途，仍须独立审批。旧授权的用途不变，迁移不向任何人授予权限。没有绑定用途指纹的旧待办预览须重新生成。用户的 AI/MCP 授权是另行同意委托时的权限上限，不能据此认定受管客户端已经具有对应资源授权；OAuth 与资源访问都须实际验收。

批量预览固定保存每位成员在整个申请时段内的授权差异，按资料版本与操作组合统计新增、扩展时段、全时段已有及撤销数（新增授权为零撤销）。多个授权可连续覆盖时段，但时间空档不能视为已覆盖。审批与逐人执行前重新核对相关授权指纹，变化后须生成新预览；没有差异快照的历史申请保持未知，不能继续批准或执行。差异描述授权记录，不替代资料或供方许可。

授权记录按当前成员分页读取；查看其他成员须具备项目成员管理权限。记录状态描述授权期限和撤销情况，不代表当前资料必然可访问。管理员可以幂等撤销指定授权，原记录与其他授权保留，另记撤销及审计。续期生成新的待审批批次，从当前时刻与原到期时间的较晚者开始，继续使用固定定义、独立审批、期限、成员和资料核验；不修改原到期时间，预览审计关联原授权。局部撤销只影响选定授权，后来独立批准的续期授权是另一条记录。

“资源授权”页默认显示当前成员记录；管理者可从有界项目成员清单中选择人员。状态说明授权期限与撤销记录，不替代当前实际访问判断。单项撤销保留其他独立授权；续期沿用固定资源包及预设版本，产生新的待审批批次，仍需独立审批和执行。HTTP及同源网页入口校验标识、拒绝额外字段、保留按操作人隔离的幂等请求并禁用缓存。切换项目或人员会清除正在编辑的操作；网络不确定重试沿用请求键。

受管项目现在通过同一条控制库查询加载来源许可、成员授权、撤销记录、修订号和查询时刻。不可变的`resource_policy_versions`为固定资料建立连续版本，保存允许操作、管理岗位、许可依据和有效期，并要求记录独立审批人；`resource_policy_revocations`追加撤销记录，保留历史。两表强制RLS，普通客户端及通用service-role均不能直接读写；许可变更同步推进项目权限修订号。

受管模式始终提供来源许可限制：当前资料缺少许可、许可已到期、尚未生效或已撤销时，均拒绝相应访问。只采用最新发布版本，不回退到旧版较宽许可；当前许可超过10,000项时整体拒绝，不返回截断授权。成员及委托人授权与来源许可取交集。未启用受管模式的项目沿用既有行为，迁移不自动授予来源许可或启用项目。部署须先完成控制库迁移，再更新API服务。账户工作区展示来源许可申请和有界资料覆盖；资源包自行填写的许可说明不构成权威许可。

资源包创建现在先检查当前来源许可，再调用Data验证端口：操作者须具有许可指定的管理岗位，请求操作不得超限，来源许可须当前有效。批次预览、批准和执行均核对拟授权时段及最长授权期限；执行时还复查原审批人当前是否仍有该来源的管理资格。来源许可撤销或管理范围收窄后，停止新的批准和执行，保留既有记录。项目及权限设置锁使这些检查与来源许可变更串行。来源管理检查及固定版本元数据核验均不要求、也不产生个人正文权限。拒绝、撤回和撤销操作不因此被禁止。

资源预览指纹同时固定所选来源许可的身份与不可变版本。对应来源重新发布许可后，即使新许可仍允许所申请动作，旧预览也不能继续批准或执行；无关来源许可变更及返回排序变化不影响当前预览。该约束与成员既有授权快照共同保存在已有预览摘要中，无需数据库迁移或公开协议变更。升级此逻辑后，旧待办理预览须重新生成；部分执行成功的成员记录保留，剩余成员不能沿用变化前的来源依据继续授权。

来源许可办理在实时成员管理或审批权限之外，还要求项目明确配置 `resource_policy_roles` 岗位；既有管理员不自动取得该岗位，种子不授权。申请清单每页最多20条，只返回声明字段。命令按操作人记录幂等回执及追加审计，申请人不能自批。发布时重查原申请人的有效直接会话、当前岗位、申请人与审批人各自的元数据可见范围、来源身份/版本以及Data的接收/发布事实。不可变许可及审批结果在同一控制库事务内保存；Data只读核验不冒充跨库原子写入，也不产生个人正文授权。拒绝、撤回不生成来源许可，撤销保留历史并使当前权威失效。外部来源在供方登记端口接入前仍拒绝。

现有资源管理HTTP模块增加 GET `/api/platform/v1/access/projects/:projectId/source-policy-requests` 与 POST `/api/platform/v1/access/source-policies/{propose,decide,withdraw,revoke}`。命令拒绝调用者自行提供的身份或审批字段，要求幂等键，响应禁止缓存；岗位仍由受控维护配置。这些接口不开放公众注册，不代替专业审核；账户工作区按相同权限区分提交、审核、撤回与撤销。

申请清单按不可变许可版本、撤销记录和有效期计算当前发布状态，并返回服务端核验时间。新版本替代旧发布记录，即使新版已撤销，也不重新启用旧许可；历史办理回执保持不变。独立审批岗位办理发布和驳回，来源登记管理岗位办理撤回和撤销，撤回还须为原申请人。网页按钮与这些服务端限制一致。

授权页使用 `same-origin` Referrer Policy：原生同意／拒绝表单保留决策路由校验所需的同源 `Origin`，外部回调不接收授权页 Referer。整页使用 `no-referrer` 会使 Chromium 在这些表单上发送 `Origin: null`，从而阻断有效授权。缺失、null 和外站来源仍须拒绝；决策后的重定向响应继续使用 `no-referrer`。参考 Playwright 服务显式设置自身公开来源，覆盖两个语言、同意／拒绝和外站引用信息保护。

### MCP 同意时固定资源范围

对于已明确启用受管模式的项目，用户同意时把本人当前有效、未撤销的 `agent-data` 授权绑定给本次新建的智能体。仅复制资源包及预设的固定版本，每项期限取原授权和委托期限中较早者；网页用途、尚未生效、已过期或撤销的授权不进入范围。当前有效授权超过 1,000 项时整体拒绝。项目和设置行锁顺序与资源管理一致；授权副本、来源审计、智能体及成员关系、连接、Audit 和 Outbox 在同一事务提交，审计失败整体回退。

本次委托由同意操作的本人批准。逐项审计保留原授权及独立审批人，以及新连接、委托和智能体标识，不把原管理员记作本次委托的审批人。每次调用仍将固定范围与本人实时授权、当前来源许可求交集。新增获批资料需要重新同意，重新同意会撤销此前委托。撤销单项授权后，其他独立有效的重叠授权可在原固定范围和期限内继续生效。受管连接没有获批的 AI/MCP 资源时不能读取资料内容；既有模式项目沿用原门禁。

本变更不改写表结构或既有数据，也不启用任何项目的受管模式。回退可恢复此前应用，并由连接所有者通过 API 撤销受影响连接，保留不可变授权及审计历史；此前未绑定资源的受管连接须重新同意。合成身份集成验证和公网协议验证不能替代用户已推迟的本人客户端验收。

GoTrue v2.195.0 可能对相同身份范围自动复用该客户端已有的同意。连接到期或新增资源授权后，如需改变 WISER 的固定范围，所有者须先通过 Supabase `oauth.revokeGrant({ clientId })`（普通用户 `DELETE /auth/v1/user/oauth/grants?client_id=...`）撤销该客户端授权，再从客户端重新发起并明确同意。这会撤销该用户在该客户端的 OAuth 会话，不影响其他用户或直接密码登录会话。只清除客户端令牌或添加 `prompt=consent` 对此固定版本不足以触发重新同意；仅撤销 WISER 连接会停止访问，但不会清除 Supabase 保存的同意。

### 本人管理 AI/MCP 连接

已登录账户区提供 `/[locale]/account/agents`，显示最近更新的最多 100 个本人连接、仍可见的项目名称、期限和当前状态。失去项目成员资格不妨碍断开连接。Supabase 客户端名称只作为不可信文本显示，不生成提供方链接或暴露凭据。

用户明确点击断开，以同源 POST 提交。服务端验证当前会话、重新读取本人连接，并从该记录取得 OAuth 客户端，不接受浏览器传入客户端标识。先撤销 WISER 连接，再清除该用户的 Supabase 授权；提供方失败时访问已停止，但页面提示重试，不报告全部完成。提供方授权已不存在时可幂等完成。表单拒绝重复或多余字段、外站或 null Origin 及超限请求体；页面以 `same-origin` 保持原生表单来源，决策响应禁用缓存并使用 `no-referrer`。断开后由用户回到原客户端重新发起并明确选择项目授权。
