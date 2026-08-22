---
title: WISER 项目概览
docType: overview
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 了解项目边界、当前交付状态与本机入口时
whenToUpdate:
  - 产品边界、交付状态或开发入口变化时
checkPaths:
  - apps/**
  - packages/**
  - compose.yaml
  - docs/roadmap.md
lastReviewedAt: 2026-08-22
lastReviewedCommit: 574446ae6c540c2e1d365473f6b0d81469ec9367
---

# WISER · 水地图

[English](./README.en.md) · 中文（默认）

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

WISER 已从单一智能体演练场重构为可继续扩展的多系统平台。Agent EXCON 与 Data Foundation / 数据基座是首批两个平级业务系统；它们共享 Fastify、Next.js、MCP、Fumadocs、Supabase Auth、可观测性入口和 WISER Design System，同时保留各自的领域模型、权威数据与 Worker。

## 当前已交付

- **统一平台**：Supabase Auth 是用户、Session、Tenant、Project、Membership、Role、Scope 与委托身份的唯一权威；Web 使用同一套 SSR Session，API 对每次请求重新验证实时授权上下文。
- **Agent EXCON**：v2 多场景、多 RunAgent 协作协议、18 个 MCP Tool、确定性评价、Receipt 回放和观测界面均保留。完整栈使用非超级用户 PostgreSQL append-only command journal 持久化 19 个 v2 mutation，并在启动时校验重放；v1 Episode 仍是显式、非持久化兼容协议。
- **Data Foundation**：22 项 Capability 的 REST、schema-first GraphQL、MCP 与文件化 Skill 共享同一 Zod 契约和 Handler。独立 data-postgres/PostGIS、SeaweedFS S3、持久任务 Worker、Transactional Outbox、PostGIS/Weaviate/OpenSearch/Neo4j/STAC 五类投影和受治理查询已接入默认 Data runtime；OGC/STAC/矢量/栅格只经统一 Auth 的 Fastify 代理暴露，四个 GIS 后端没有 host port。
- **统一产品界面**：Data Foundation 在现有 Next.js 应用中提供目录、不可变版本选择、入库、质量、血缘、知识、图谱、GIS、Operation 和 Capability 页面。地图通过同源 Session 代理组合 PostGIS authority、STAC extent、vector MVT、raster 四图层；所有可见文案都有 `zh-CN`/`en`，中文默认，并复用 Agent EXCON 的浅色/深色主题和响应式 Shell。
- **统一文档**：中英文架构、快速开始及 Agent EXCON/Data REST、GraphQL、MCP 协议都由同一个 Fumadocs 应用发布并受 Docpact 治理。

## 仓库边界

```text
apps/           共享 API、Web、MCP、文档，以及各系统 Worker
packages/       平台 contracts/auth 与各系统 contracts/core/infra
infrastructure/ 精确镜像、Data Foundation、Docker 与可观测性配置
skills/         可独立加载的 Agent EXCON 与 Data Foundation Skills
supabase/       统一 Auth、控制面、EXCON schema、迁移、种子与 pgTAP
scenarios/      版本化演练场景及来源清单
tests/          跨边界 fixture 与验收测试
```

依赖方向固定为 `platform contracts <- system contracts <- core <- application <- infra/apps`。MCP、Skill 和浏览器只调用 HTTP API，不直连权威数据库或投影存储。Data Foundation 投影可重建，不能成为授权或发布权威。

## 环境基线

- Node.js 24 LTS（范围 `>=24.18.0 <25`）
- pnpm `11.22.0`
- TypeScript `7.0.2`
- Docker Engine 29+ / Docker Compose 5+
- workspace 固定的 Supabase CLI

npm 依赖使用精确版本并由一个 `pnpm-lock.yaml` 锁定；容器使用稳定 tag 加 `sha256` digest，Data Foundation 镜像登记在 [`infrastructure/data-foundation/versions.env`](./infrastructure/data-foundation/versions.env)，禁止 `latest`。

本轮关键应用 pin：AWS S3 SDK/presigner `3.1116.0`、Next.js `16.3.2`、Fumadocs core/UI `16.15.0` 与 MDX `15.3.1`、MapLibre GL JS `6.5.0`。pnpm 仍对其他包执行 24 小时 `minimumReleaseAge`；只对这些刚核验并精确锁定的 AWS/Smithy、Next、Fumadocs、MapLibre 包做窄例外。GraphQL `16.14.2` + Mercurius `16.10.0` 是当前 Fastify 5/TS7 兼容线；`@types/node` `24.13.3` 刻意对齐 Node 24，而不追随不同 runtime major。

## 安装与验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm supabase:verify
pnpm data:verify
```

仓库使用 Docpact 0.1.9。修改前根据实际路径查询文档路由，修改后检查工作区文档义务：

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'packages/data-core/src/**'
pnpm docpact:check
pnpm docpact:validate
```

## 启动完整平台

一条命令启动 Supabase、统一 Auth、持久化 EXCON v2、Data Foundation、API、Web、MCP 和文档，执行迁移、种子与真实 18 步 smoke：

```bash
pnpm stack:full:up
```

`stack:full:up` 会在被 Git 忽略的 `.wiser/local/runtime-secrets.json` 创建并复用本机密钥，给 EXCON journal 配置非超级用户登录，随后执行 `data:up → data:migrate → data:seed → data:smoke`。它不会读取或挂载 `~/.codex/auth.json`，也不会把 Supabase service-role key 注入应用。

常用入口：

| 表面                  | 地址                                      |
| --------------------- | ----------------------------------------- |
| WISER Web             | `http://127.0.0.1:3000/zh-CN`             |
| Fastify API / GraphQL | `http://127.0.0.1:3001` / `POST /graphql` |
| Fumadocs              | `http://127.0.0.1:4321`                   |
| Data Worker           | `http://127.0.0.1:13003/health/ready`     |
| MCP Streamable HTTP   | `http://127.0.0.1:13004/mcp`              |
| Supabase Studio       | `http://127.0.0.1:56323`                  |

只需分步运行时：

```bash
pnpm supabase:start
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
```

`data:smoke` 真实上传 GeoJSON 与 Markdown，执行 ClamAV、SHA-256、Tika/GeoJSON 解析、fake AI 计划、确定性转换、质量/人工审核、权威版本提交、Outbox、五类投影，并通过 REST、GraphQL、MCP 和登录后的 Web 目录复核；随后重放同一 Outbox event，确认无重复版本、对象、节点或投影。

普通停止保留数据：

```bash
pnpm data:down
pnpm stack:down
```

删除 Data Foundation 命名卷需要显式确认：

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

## 需要明确的兼容边界

- EXCON v2 的生产/完整栈持久层是单写者 append-only command journal 加确定性重放；它不是把每个 v2 聚合直接映射到规范化 PostgreSQL repository。journal 锁、哈希、生成值 tape 或秘密引用不一致时会失败关闭。
- v1 Episode 保留为显式兼容实现且仍使用内存状态；v2 失败不会自动降级到 v1。
- Data Foundation Web 当前是有身份的治理与查询工作区；上传、提交、审核等 mutation 通过 REST、GraphQL、MCP 或 Skill 发起，浏览器不持有数据库、对象存储或投影凭据。
- fake AI/embedding 只用于测试、CI 和本机可重复 smoke，不代表生产模型输出；确定性质量、验收和发布结论始终由本地规则与人工门禁决定。

更详细的启动步骤见 [快速开始](./apps/docs/src/content/docs/zh-CN/quick-start.md)，Data 事实边界见 [数据基座架构](./apps/docs/src/content/docs/zh-CN/architecture/data-foundation.md)，贡献约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可

代码采用 [MIT License](./LICENSE)。场景数据和第三方材料继续遵循各自 `PROVENANCE.md` 与数据许可；MIT 不自动覆盖这些材料。
