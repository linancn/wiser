---
title: 智能体接入与 Skill 交付
description: 复制接入指令，校验 WISER Skill 发行包，并通过部署声明的受治理协议连接项目。
docType: protocol-reference
scope: platform-agent-setup
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 将 AI 智能体接入 WISER 或发布 Skill 时
whenToUpdate:
  - 接入地址、发行文件、完整性校验或连接指令变化时
checkPaths:
  - apps/api/src/platform/agent-setup.ts
  - skills/wiser-data-foundation/**
  - apps/web/src/components/agent-setup*
  - apps/docs/src/components/agent-setup*
lastReviewedAt: 2026-09-08
lastReviewedCommit: cee9c51ac26e77bd078edc3af41cfb6ca0de611d
---

Portal 和文档页面提供**让智能体接入 WISER**。点击后，把复制的指令发送给 AI 助手。按钮只复制公开的接入地址，不授予账户或项目权限。浏览器不允许自动复制时，会显示可选择的同一段指令。

## 公开交付契约

共享 API 提供以下无需登录的资源：

| 资源                                     | 用途                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `/agent-setup/prompt.md`                 | 当前可供智能体读取的接入说明                                                    |
| `/agent-setup/manifest.json`             | `wiser.agent-setup.v1`，包含 API、可选 MCP 地址、按内容固定的发行标识和文件清单 |
| `/agent-setup/releases/{release}/{path}` | 精确发行版本中的允许文件                                                        |

清单包含 `SKILL.md`、智能体元数据、协议/治理/示例/数据包参考文档，以及两个 Python 数据包辅助脚本。每个文件包含相对路径、公开地址、字节数和 SHA-256；发行标识由有序文件描述计算。版本地址只返回对应的精确内容并允许不可变缓存，未知版本或清单外文件返回 `404`。来源数据包、环境文件、凭据和测试材料不在发行包内。安装全部清单文件时应保留相对目录，并逐一校验大小和哈希。

运行中的进程只声明当前发行版本，不承诺部署更新后仍保留旧版本。若安装过程中部署发生变化、旧文件返回 `404`，重新取得当前清单并从头校验，不能混装不同版本的文件。

## 连接与验证

接入指令识别当前客户端及其项目 Skill 位置，保留无关配置和有本地修改的 Skill。执行业务操作前先发现 API 的当前能力。Skill 安装完成与账户连接成功是两个独立结果。

配置了 `mcpResource` 时，清单声明该部署的原生 OAuth MCP 入口。客户端通过受保护资源发现与 PKCE S256 完成连接，并在 WISER 授权流程中选择项目和受限访问范围；`wiser_connection` 用于核对实际身份与范围。默认只查询，需要执行入库任务时才请求入库权限。身份交换遵循既有 [Platform Auth](/architecture/unified-auth/) 与 [Data MCP](/protocols/data-mcp/) 契约。

清单没有 `mcpResource` 时，指令明确使用 Skill 的 HTTP 流程，身份由受信任的 WISER Auth 任务上下文提供，不虚构原生 MCP 已连接。客户端不支持所需协议时必须说明限制。接入指令和剪贴板均不包含密码、Bearer 或租户秘密。

接入最后执行一次有界目录读取，并报告实际结果、已安装发行版本和已验证的项目上下文；不能仅为验证安装而执行入库。后续研究数据包按发行包内 `references/water-bundle.md` 执行全量核对、限定范围的登记、明确复核、不可变发布和文件哈希回读。登记完整性与分析质量、数据集完整性分别表达。

## 部署

为 Web 和 Docs 设置 `WISER_AGENT_SETUP_URL`，指向公开 API 的 `/agent-setup/prompt.md`。本机开发默认使用 `http://127.0.0.1:3101/agent-setup/prompt.md`。生产 Docs 预渲染页面，因此构建时也必须提供目标公开地址，不能只设置运行时配置。

API 根据 `DATA_PUBLIC_API_ORIGIN` 生成公开文件地址，仅在配置后声明 `WISER_AGENT_MCP_RESOURCE`。除 loopback 外使用公开 HTTPS 地址；内部 Docker 主机名、用户信息、查询凭据和片段都会被拒绝。声明 MCP 地址不会启动或授权该 Gateway：应按 MCP 协议配置 OAuth 模式及一致的 issuer/resource，并实际验证元数据和连接后再宣布可用。
