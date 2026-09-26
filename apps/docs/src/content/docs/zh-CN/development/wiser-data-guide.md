---
title: 使用 WISER 查阅资料与连接智能体
description: 使用现网组织账户查阅资料、准备样本试录入，并了解外部智能体连接的当前状态。
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
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

## 当前可用范围

| 事项        | 当前状态                                                        | 开始方式                                                                                  |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 网页查阅    | 公网门户可访问；登录后只显示本人获准的项目与资料                | [打开 WISER 门户](https://wiser.thuenv.tiangong.world:7100/zh-CN)                         |
| 账户        | 已有账户可用邮箱和密码登录；公众自行注册关闭                    | 需要账户或项目权限时联系项目管理员                                                        |
| 数据接入    | 可在获准项目内发起接入并查看检查、审核和发布进度                | [查看接入任务](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/ingestions) |
| 外部 AI/MCP | 公开 OAuth/MCP 协议入口可用；本人实际客户端的端到端验收仍待完成 | 按下文连接并核对项目范围                                                                  |

网页入口、MCP 未登录挑战及注册设置于 2026-09-26 核对。先前使用合成普通账户完成的协议与授权检查证明这些路径可以工作，不代替本人实际客户端验收，也不代表所有第三方客户端兼容。

## 查阅与核对资料

1. 使用本人已有的组织账户[登录门户](https://wiser.thuenv.tiangong.world:7100/zh-CN)，确认当前项目。
2. 在[资料目录](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/catalog)按名称查找，或在[数据探索](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/explore)联动查看记录、地图和关联证据。[资料检索](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/search)适合跨来源查找。
3. 打开固定版本，核对原件、来源、许可、安全等级、质量检查范围和适用限制。解析记录数不等于独立观测数；地图上可见的位置也不代表已经完成科学位置核验。

看不到预期项目或资料时，先确认是否切换到正确项目，再联系项目管理员核对成员资格、来源许可和资料授权。不要使用其他人的账户或客户端令牌绕过访问范围。

## 黑臭水体样本试录入

只有获准用于当前项目、且本人具有录入权限的资料才能试录入。先整理原件、来源说明、许可依据及文件完整性，再通过[智能体接入说明](/protocols/agent-setup/)发起有界接入。取得任务编号后，在[接入任务页](https://wiser.thuenv.tiangong.world:7100/zh-CN/data-foundation/ingestions)查看检查、人工审核和发布进度。

上传成功、解析完成、来源登记通过与正式发布是不同状态。试录入不能作为黑臭水体科学结论或专业审核结果；使用资料前仍须核对其时间、范围、单位、完整性与适用尺度。

## 连接外部 AI/MCP 客户端

客户端须支持 OAuth 2.1 授权码流程与 PKCE S256。将其 Streamable HTTP MCP 地址设为 https://mcp.wiser.thuenv.tiangong.world:7100/mcp，并由客户端完成受保护资源发现、回调登记和登录；协议字段见 [Data MCP](/protocols/data-mcp/) 与[统一身份](/architecture/unified-auth/)。

1. 在浏览器使用本人已有的 WISER 账户登录，核对申请访问的客户端及返回地址。
2. 明确选择一个获准项目、查询或录入范围、最高资料级别，以及 15 分钟或 1 小时有效期。不同意时可直接拒绝。
3. 回到原客户端，先做一次小范围目录查询，核对实际项目、资料与操作范围。接入指令或 Skill 安装本身不授予权限。
4. 在账户菜单的“AI/MCP 连接”中可断开本人授权。到期后或需要扩大资料范围时，先断开，再从原客户端重新发起并明确同意。受管项目中的网页访问和 AI/MCP 访问需要分别获批。

不要把密码、授权码或令牌贴进聊天、工具参数或日志。若断开时页面提示旧同意记录尚未清除，按页面操作完成清除；资料访问已停止，但重新连接前仍应核对状态。

## 本人客户端验收

目前尚无本人实际客户端完成的端到端验收记录。验收时记录客户端名称、所选项目和不含秘密的调用结果，至少核对：获准资料可读、其他项目和未获准操作被拒、主动拒绝授权、授权到期，以及断开后原访问立即停止。完成这些检查后，才能把该客户端标为已验收；此前的合成账户检查不能替代这一步。
