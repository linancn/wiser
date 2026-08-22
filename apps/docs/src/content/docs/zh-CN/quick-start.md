---
title: 快速开始
description: 在本机启动并验证统一 Auth、持久化 Agent EXCON v2 与 Data Foundation 完整纵切。
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 首次安装、验证或启动本机完整 WISER 平台时
whenToUpdate:
  - 工具链、命令、端口、本机身份或服务入口变化时
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 574446ae6c540c2e1d365473f6b0d81469ec9367
---

## 先认识当前边界

完整本机栈共享一套 Supabase Auth、Fastify API、Next.js Web、MCP 和 Fumadocs：

- Agent EXCON v2 的 19 个 mutation 写入 Supabase PostgreSQL 中的 append-only command journal，服务重启时以生成值 tape 和结果哈希做确定性重放；只允许一个非超级用户 writer。v1 Episode 是显式、内存兼容协议。
- Data Foundation 的 22 项 Capability 已接入独立 data-postgres、SeaweedFS、具体入库 Worker、五类投影、REST、GraphQL、MCP、Skill 和统一 Web 查询界面。
- Data Web 需要真实 Supabase Session，并由 server-only DAL 把 Access Token 转发给 API；浏览器不获得数据库、S3 或投影凭据。
- 中文 `zh-CN` 为默认语言，英文页面同构；两个系统共享浅色/深色主题、语义 token、键盘和响应式行为。

## 工具基线

| 工具         | 仓库基线                                 |
| ------------ | ---------------------------------------- |
| Node.js      | 24 LTS，`>=24.18.0 <25`                  |
| pnpm         | `11.22.0`                                |
| TypeScript   | `7.0.2`，所有应用显式使用 TypeScript CLI |
| Docker       | Engine 29+ / Compose 5+                  |
| Supabase CLI | workspace 精确锁定版本                   |
| Docpact      | `0.1.9`                                  |

关键 UI/数据依赖同样精确锁定：AWS S3 SDK/presigner `3.1116.0`、Next.js `16.3.2`、Fumadocs core/UI `16.15.0`、Fumadocs MDX `15.3.1`、MapLibre GL JS `6.5.0`。pnpm 对其他包保持 24 小时供应链冷却，只对这组刚核验的新稳定 vendor 包做窄 `minimumReleaseAgeExclude`；冻结 lockfile 仍固定每个 integrity。

兼容性优先于盲目追 major：GraphQL `16.14.2` + Mercurius `16.10.0` 是实际通过 Fastify 5/TS7 build 的组合；`@types/node` `24.13.3` 与 Node 24 runtime 对齐。GraphQL 17 或更新 Node 类型 major 不属于本轮兼容边界。

```bash
node --version
pnpm --version
docker compose version
```

## 安装与静态验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm supabase:verify
pnpm data:verify
```

`pnpm verify` 依次检查格式、lint、类型、单元/集成测试、所有 workspace build 与 Compose config。`supabase:verify` 重置本机 Supabase、运行 pgTAP、lint 与 advisors；`data:verify` 覆盖 Data 脚本、contracts/core/infra/Worker 测试、类型、build 和 profile config。

## 文档治理

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'apps/api/src/data-foundation/**'
pnpm docpact:check
pnpm docpact:validate
```

`route` 必须使用实际改动路径。`check` 命中 `review_or_update` 时应真正阅读并更新文档，或在确认仍准确后记录显式 review；不要用 baseline/waiver 常规跳过。

## 一条命令启动完整平台

```bash
pnpm stack:full:up
```

该命令按顺序：

1. 启动 Supabase Auth/PostgreSQL/Storage/Studio；
2. 读取 Supabase 的 publishable 运行信息并用本机 seed operator 登录；
3. 在被 Git 忽略的 `.wiser/local/runtime-secrets.json` 创建或复用权限为 `0600` 的本机 HMAC/数据库密钥；
4. 只给非超级用户 `wiser_excon_api` 配置 journal 登录，不把 service-role key 注入应用；
5. 构建一个共享 WISER 应用镜像并等待默认服务与 `data-foundation` profile 健康；
6. 运行 Data 的 checksum migration、确定性 seed 和 18 步端到端 smoke。

`.env` 只用于本机覆盖；默认完整栈不要求把真实秘密写进仓库。生产必须由密钥系统提供所有 credential，且不能复用 Compose 的本机默认值。

若要逐步观察：

```bash
pnpm supabase:start
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
```

`data:migrate` 在 session advisory lock 下校验 `0001`–`0008` 文件名与 SHA-256。`data:seed` 可重复执行。`data:up` 可重复运行；OpenSearch ICU initializer、对象存储 bucket 初始化和 API/Worker/GIS runtime role provisioning 都按现有状态安全收敛。

## 18 步真实 smoke

`pnpm data:smoke` 使用 `sample-stations.geojson` 与 `sample-evidence.md`，按固定顺序证明：

1. 创建预签名上传 Session；
2. 上传两个 fixture 并完成 Session；
3. 创建并幂等提交入库；
4. ClamAV 扫描；
5. SHA-256 指纹；
6. GeoJSON/Tika 解析；
7. fake AI 计划和受控验证；
8. 确定性转换；
9. 质量检查；
10. 人工门禁后提交不可变权威版本；
11. 提升 raw 内容对象；
12. 同事务写 Outbox；
13. 构建 PostGIS、Weaviate、OpenSearch、Neo4j、STAC 五类投影；
14. 五项 `projection_status=SUCCEEDED`；
15. REST 目录与综合检索；
16. GraphQL 目录查询；
17. MCP `data_catalog_get`；
18. 登录后的中文 Web 目录，并重放同一 Outbox event 验证无重复。

失败时脚本输出 Data services、API 与 Web 的最近日志；它不会把 credential 或对象正文写入报告。

## 本机入口

| 服务                    | 地址                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Web / Data Foundation   | `http://127.0.0.1:3000/zh-CN/data-foundation`                     |
| API / Data REST         | `http://127.0.0.1:3001` / `/api/data/v1`                          |
| GraphQL                 | `http://127.0.0.1:3001/graphql`                                   |
| Fumadocs                | `http://127.0.0.1:4321`                                           |
| Supabase Studio         | `http://127.0.0.1:56323`                                          |
| data-postgres           | `127.0.0.1:55432`                                                 |
| SeaweedFS S3            | `http://127.0.0.1:18333`                                          |
| Weaviate                | `http://127.0.0.1:18080`                                          |
| OpenSearch / Dashboards | `https://127.0.0.1:19200` / `http://127.0.0.1:15601`              |
| Neo4j HTTP              | `http://127.0.0.1:17474`                                          |
| 受控 OGC / STAC         | `http://127.0.0.1:3001/api/data/v1/geo/ogc/...` / `/geo/stac/...` |
| 受控矢量 / 栅格瓦片     | `http://127.0.0.1:3001/api/data/v1/geo/tiles/...`                 |
| Tika / ClamAV           | `http://127.0.0.1:19998` / `127.0.0.1:13310`                      |
| Data Worker             | `http://127.0.0.1:13003/health/ready`                             |
| MCP Streamable HTTP     | `http://127.0.0.1:13004/mcp`                                      |

所有已发布端口都只绑定回环地址。GeoServer、STAC API、TiTiler 和 Martin 完全不发布 host port，只能由 Fastify 在统一 Auth、`data.geo.read`、RLS/version 检查和 audit 后访问；数据库、投影管理口与凭据不提供给浏览器或外部 Agent。

## 本机登录与查询

Supabase seed 提供仅用于本机 fixture 的 operator：

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

从 `http://127.0.0.1:3000/zh-CN/login` 登录后进入数据基座。Web 展示目录、版本、来源/授权、安全等级、质量/验收状态、入库状态机、问题、Agent run、Operation event、投影状态、血缘、检索、图谱和地图。DataItem detail 可用 `?version=<uuid>` 切换不可变版本并打开地图；地图接受 bbox、Version、EPSG:4326/4490，提供 PostGIS authority、STAC extent、vector MVT、raster 四个可访问图层开关。浏览器只访问同源代理，服务器短期 Session 与内部 GIS 地址不进入页面。写操作通过 [Data REST](/protocols/data-rest/)、[Data GraphQL](/protocols/data-graphql/)、[Data MCP](/protocols/data-mcp/) 或 `skills/wiser-data-foundation` 执行。

## 单独使用 MCP

stdio 与 Streamable HTTP 都只调用 HTTP API。独立启动前准备一个真实 Supabase JWT 或 `wdc1.` 委托 credential：

```bash
export DATA_API_URL=http://127.0.0.1:3001/api/data/v1/
export DATA_API_BEARER_TOKEN=<short-lived-bearer>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

Streamable HTTP 还需要只用于 `/mcp` 边界的 `DATA_MCP_BEARER_TOKEN`；它不是下游 Data API identity。

## 停止与清理

只停止 Data profile，保留 API/Web 和所有命名卷：

```bash
pnpm data:down
```

停止整个 Compose 与 Supabase：

```bash
pnpm stack:down
```

只有确认要删除 allowlist 内的 Data Foundation 卷时运行：

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

脚本会核对 Compose project 与精确卷清单，不能删除 Supabase 或 observability 卷。
