---
title: WISER 资料查阅与黑臭水体样本试录入指南
description: 现网网页入口、样本试录入边界与 AI/MCP OAuth 联调状态。
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 在现网查阅资料或准备黑臭水体样本试录入时
  - 将外部 MCP 客户端接入现网 WISER 时
whenToUpdate:
  - 公网入口、数据权限流程或 OAuth 端到端验收状态变化时
checkPaths:
  - apps/web/src/app/**/oauth/**
  - apps/mcp/src/**
  - supabase/config.toml
lastReviewedAt: 2026-09-26
lastReviewedCommit: b842f324611ce7d8dfacf4ab522c4adb604d2a71
---

## 网页入口

以下五个入口均使用公网 HTTPS `:7100`。登录时请使用本人已有的 WISER 账户；系统只显示当前账户获准的项目和资料。

| 用途           | 网页                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| WISER 门户     | [打开门户](https://wiser.thuenv.tiangong.world:7100/zh-CN)                                |
| 已发布资料目录 | [查阅目录](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/catalog)        |
| 跨资料检索     | [检索资料](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/search)         |
| 探索与核对     | [探索资料](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/explore)        |
| 试录入任务     | [查看录入任务](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/ingestions) |

查阅黑臭水体资料时，先确认当前组织和项目，再核对资料来源、版本、许可、安全级别和质量状态。样本试录入只面向本人拥有录入权限、且已获准用于该项目的资料；发起后应检查任务和质量反馈。上传或完成解析不等于资料已获批准发布，不要将试录入结果直接当作已核准的科学结论。

## 外部 AI/MCP 接入

**本人客户端端到端状态：BLOCKED（截至 2026-09-26，用户推迟联调）。** 使用现有合成普通账号、真实 Chromium 浏览器及官方 MCP TypeScript SDK 1.30.0 的公网协议与权限验收已通过。此证据不能替代本人实际客户端验收，也不代表第三方客户端均已兼容。

支持 OAuth 2.1 授权码与 PKCE S256 的 MCP 客户端按以下顺序接入：

1. 将 Streamable HTTP MCP 地址配置为 `https://mcp.wiser.thuenv.tiangong.world:7100/mcp`。不要填写旧的 `127.0.0.1:13004` 地址。
2. 客户端从 401 的 `WWW-Authenticate` 找到受保护资源元数据，再发现 issuer `https://auth.wiser.thuenv.tiangong.world:7100/auth/v1`，通过动态客户端注册登记自己的回调地址。授权请求须带准确的 `resource`、`redirect_uri` 与 PKCE S256 challenge。
3. 在浏览器用本人已有的 WISER 账户登录。授权页面会显示客户端、回调主机以及本人可授权的项目；明确选择一个项目、查询或录入模式、最高资料级别与 15 分钟或 1 小时有效期，然后点击同意；也可以点击拒绝。此流程不需要 Google、GitHub 等第三方登录。
4. 客户端接收授权码并自行在公网 Auth 令牌端点交换，之后把 OAuth Bearer Token 放在 MCP 请求头。客户端和用户不得把密码、授权码或令牌贴进聊天、工具参数或日志。
5. 从账户菜单打开“AI/MCP 连接”，可断开本人连接，同时清除该客户端保存的同意记录。连接到期或需要新增资料范围时，先断开，再回到原客户端重新发起并明确同意；仅清除客户端令牌不足以让当前授权服务器再次显示同意页面。受管项目需要管理员分别批准“网页访问”和“AI/MCP 访问”用途。
6. 本人联调仍须记录客户端名称、所选项目与调用结果，检查获准查询、跨项目和未获准操作拒绝、拒绝授权、到期及撤权。不要提交密码、授权码或令牌。断开未完全完成时，访问已停止，但须按页面提示重试清除旧授权。

### 已完成的独立检查

2026-09-26 在公网 `:7100` 验证，使用现有合成普通身份，业务访问未使用管理员密钥：

| 检查             | 已取得的证据                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发现及未授权响应 | MCP 公网 resource、Auth HTTPS issuer 和授权/令牌端点正确；未授权返回 401 与正确的 `WWW-Authenticate`。                                                                                      |
| 完整授权协议     | 真实浏览器密码登录、明确选择项目并同意，PKCE S256 授权码交换成功；官方 SDK 初始化、列出工具和实际资料调用成功；点击拒绝返回 `access_denied` 且没有授权码。                                  |
| 资源与项目边界   | 独立审批的 A 资料及其两条记录可读；未批 B、另一项目和未批准导出均拒绝。新增 B 不会进入旧委托，撤销旧同意并重新明确授权后才可读。                                                            |
| 撤销与期限       | 同一未过期 OAuth 令牌在撤销 A 后立即失去 A；B 按真实时钟到期后停止读取。原委托到期与原 OAuth JWT 自然到期后均返回 401；JWT 到期检查使用的委托此前已过期，不将两种拒绝原因混为独立隔离证明。 |
| 原有功能与入口   | 普通密码会话仍可读原项目 2,409 项资料，跨项目及撤销会话被拒；其他 30 个容器 ID、镜像及启动时间未变；HAProxy 原有段保留，7770/7800 HTTPS 响应分别与现有后端一致。                            |
| 路由与注册       | Auth 主机仍拒绝 REST、Storage 和网关状态路由；注册设置与实际拒绝行为如下。                                                                                                                  |

对应修复与验证记录见 [PR #87](https://github.com/linancn/wiser/pull/87)、[PR #88](https://github.com/linancn/wiser/pull/88)、[PR #89](https://github.com/linancn/wiser/pull/89)、[PR #90](https://github.com/linancn/wiser/pull/90)。这些变更均通过六个 CI 验证通道与汇总门禁。现场 JSON 验收收据和回退配置由部署维护者保存；不在指南中发布认证材料。测试资料明确为合成权限夹具，不能作为黑臭水体科学数据或专业审核结论。

### 自行注册状态

2026-09-26 经部署负责人明确要求，现网已关闭公众自行注册。`/auth/v1/settings` 返回 `disable_signup=true`，GoTrue 持久配置为 `GOTRUE_DISABLE_SIGNUP=true`，仓库的 `[auth] enable_signup=false` 与之保持一致。公网 `POST /auth/v1/signup` 实测返回 `422 signup_disabled`；检查请求不含密码，未创建测试账户。

已有账户的邮箱密码登录保持开启，账号、会话、项目及成员权限数量核对未变。需要新账户时联系项目维护者，经授权的账户开通或邀请流程处理；账户开通不自动授予项目权限。此检查不替代本人登录、邮件邀请和真实 MCP 客户端的端到端验收。
