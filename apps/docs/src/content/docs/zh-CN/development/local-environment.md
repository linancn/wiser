---
title: 本机开发环境
description: WISER 完整栈、单应用开发、端口、身份、日志、停止与重置参考。
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 选择本机运行模式或排查服务启动问题时
whenToUpdate:
  - Compose profile、端口、脚本或环境变量变化时
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-09-11
lastReviewedCommit: a099092f20f43e36453d4456a0c36fc8f932dd26
---

## 运行模式

| 模式         | 命令                      | 能证明什么                                                                 |
| ------------ | ------------------------- | -------------------------------------------------------------------------- |
| 完整平台     | `pnpm stack:full:up`      | 统一 Auth、持久 EXCON API、Data Foundation、Data MCP 与登录 Web 的默认集成 |
| 基础栈       | `pnpm stack:up`           | Supabase + 默认 Compose；API 使用本机兼容配置，不启用 Data profile         |
| Data profile | `pnpm data:up`            | 在已可用的本机 Supabase 身份上启动默认服务和全部 Data 基础设施             |
| 可观测性     | `pnpm observability:up`   | 在共享应用镜像已构建后启动 Telemetry Ingress 与 OTel/Grafana 栈            |
| 单应用       | 使用下面的 workspace 命令 | 纯 UI、协议或单元测试循环                                                  |

`data:up` 不是脱离平台的独立数据栈：它读取运行中的本机 Supabase 状态、登录 seed operator，并通过 Compose profile 连同默认应用服务一起收敛。干净机器应优先使用 `stack:full:up`。

## 宿主准备

本地开发必须加载 `compose.override.yaml`，显式指定文件时也要包含它：`docker compose -f compose.yaml -f compose.override.yaml ...`。如果还需要 case/runtime 文件，仍须保留本地 override，并在启动、构建或重建服务前核对合并顺序和最终配置。保留用户手动修改的本地配置，不得静默覆盖其中的端口、源码挂载或开发命令。配置检查与后续 Compose 操作使用同一组文件；`docker compose ... config --quiet` 可校验配置而不打印解析后的秘密。

- 完整 Data profile 会同时运行数据库、ClamAV、搜索、图谱与 GIS，资源上限以 `compose.yaml` 为准；启动前确认 Docker 可用容量与磁盘，而不是依赖一个未经仓库验证的“最低配置”数字。
- 部分镜像在 Apple Silicon 上使用显式 `linux/amd64` 模拟，首次拉取、初始化和健康检查会更久。
- 安装和首次构建需要访问 npm registry 与容器 registry。
- OpenSearch one-shot init 会下载并校验与 3.8.0 精确匹配的官方 `analysis-icu` 与 `analysis-smartcn` 插件；readiness 要求两者同时出现。插件使用独立命名卷，版本或 checksum 变化时应在可丢弃环境执行确认式 Data reset，再从权威数据重建版本化检索投影。
- 启用 Data profile 时，API 会等待该初始化任务导出 OpenSearch CA 后才启动。Node 在进程启动时加载 `NODE_EXTRA_CA_CERTS`，之后补齐文件无法修复已启动 API 的信任配置。未启用 Data profile 时该依赖为可选，基础栈仍可独立启动。
- 确认下表端口没有被其他进程或旧 Compose project 占用；端口冲突时先定位占用者，不要随意改一端而遗漏相关回调、CORS 或 smoke 配置。

## 主要端口

| 服务                                         | 本机入口                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| Web                                          | `http://127.0.0.1:3100`                              |
| API / OpenAPI                                | `http://127.0.0.1:3101` / `/openapi.json`            |
| EXCON v1 compatibility Worker health         | `http://127.0.0.1:3002/health/ready`                 |
| Docs                                         | `http://127.0.0.1:4321`                              |
| Data Worker health                           | `http://127.0.0.1:13003/health/ready`                |
| MCP HTTP                                     | `http://127.0.0.1:13004/mcp`                         |
| Supabase API / PostgreSQL / Studio / Mailpit | `56321` / `56322` / `56323` / `56324`                |
| data-postgres                                | `127.0.0.1:55432`                                    |
| SeaweedFS S3                                 | `http://127.0.0.1:18333`                             |
| Weaviate                                     | `http://127.0.0.1:18080`                             |
| OpenSearch / Dashboards                      | `https://127.0.0.1:19200` / `http://127.0.0.1:15601` |
| Neo4j HTTP                                   | `http://127.0.0.1:17474`                             |
| Tika / ClamAV                                | `http://127.0.0.1:19998` / `127.0.0.1:13310`         |
| Telemetry ingress / Grafana / Prometheus     | `14318` / `3300` / `9090`                            |
| OTel gRPC / HTTP / health                    | `4317` / `4318` / `13133`                            |

GeoServer、STAC API、TiTiler 与 Martin 没有 host port；只能由统一 Auth 后的 API 代理访问。

Compose 与独立开发都使用 Web `3100`、API `3101` 作为宿主机入口；Compose 内部端口仍为 `3000`、`3001`。浏览器参考测试使用 `3200`，独立 EXCON Lab 默认使用 `3201`，独立 MCP HTTP 默认使用 `3004`。Supabase Auth 回调使用 Web 的 `3100` 地址，无需本机端口覆盖配置。

## 单应用命令

在不同终端中按需启动：

```bash
pnpm --filter @wiser/api dev
pnpm --filter @wiser/web dev
pnpm --filter @wiser/docs dev
```

也可以用 `pnpm dev` 并行启动这三个进程：Web 固定在 `3100`，API 默认使用 `3101`，Docs 固定在 `4321`。API 在缺少生产配置时使用 Auth off、Agent EXCON memory、Data Foundation off 的本机兼容模式。这个模式适合协议和 UI 循环，不验证统一 Auth、数据库持久化或 Data 功能。

## 身份边界

Data Foundation Web 使用 Supabase SSR Session，完整栈会为 Data smoke 和 Data MCP 注入本机 operator JWT。Agent EXCON live Web 转发已验证的当前 Supabase 用户 Session，`WISER_WEB_OPERATOR_TOKEN` 仅用于本机 Auth-off 预览；EXCON MCP 仍需要绑定具体 RunAgent 的 `AGENT_EXCON_API_KEY`。因此“进程健康”不等于这两个 EXCON 客户端已经获得有效身份，失败时必须保留显式 unavailable/鉴权错误。

共享 MCP 进程总会初始化 EXCON HTTP client；即使只开发 Data MCP，也必须配置非空 `AGENT_EXCON_API_KEY` 和完整 `DATA_*`。Data Tool 不会发送该 EXCON key，因此本机占位值可以用于 Data-only 进程配置；它不是统一 Auth 身份，也不能调用 `excon_*`。

### 如何取得本机身份

- 人类开发者在 `/zh-CN/login` 使用 quick-start 的 seed operator 登录，Web 通过 Supabase Session 访问 Platform 与 Data 页面。
- Agent/服务 delegated credential 由有 `platform.delegation.manage` 的 Supabase 人类通过 `/api/platform/v1/delegations` 创建、签发、轮换和撤销；明文只返回一次。
- EXCON MCP 的 `AGENT_EXCON_API_KEY` 必须来自受信任的 Run 编组/bootstrap，并绑定一个具体 RunAgent。仓库没有把 seed 密码自动换成通用 EXCON token 的 CLI；本机完整协作可使用版本化 Cookbook/Showcase 创建受限会话。
- EXCON live Web 复用当前登录用户 Session，并要求该用户具有 operator 授权；Supabase 模式不需要单独签发 Web operator token。

具体 header、scope 与调用顺序见 [Platform Auth](/architecture/unified-auth/)、[Agent EXCON HTTP](/protocols/http/) 和 [MCP](/protocols/mcp/)。

## 环境变量与秘密

Web 与 Docs 通过公开的 `WISER_AGENT_SETUP_URL` 生成可复制的智能体接入指令，本机默认为 `http://127.0.0.1:3101/agent-setup/prompt.md`。部署时指向公开 API，生产 Docs 构建时也需提供。API 的 `DATA_PUBLIC_API_ORIGIN` 控制按内容固定的 Skill 下载地址。发行校验与独立的身份连接见[智能体接入](/protocols/agent-setup/)。

Data Foundation Skill 的研究数据包辅助脚本使用 Python 3 标准库。清点阶段校验包清单和下载清单，将注册入口合并到完整数据源目录，并核对清单外文件，保持来源目录不变。运行 `python3 -B skills/wiser-data-foundation/scripts/water_bundle.py inventory --bundle /absolute/source --out /absolute/output/inventory.json`。这是本机准备步骤；正式入库只能通过统一 HTTP API。Skill 参考文档说明凭据排除、脱敏副本、完整性状态与显式启用的真实案例测试。

Compose 的 `DATA_INGESTION_MAX_OBJECT_BYTES` 默认是 64 MiB，并允许显式环境配置覆盖，可容纳本案例最大的 36,378,636 字节文件。这是 Worker 的单对象上限；来源登记仍逐一校验精确内容，不把部分下载或未解析内容宣称为可分析数据。

`.env.example` 是变量目录，不是可直接用于生产的配置。完整栈会把本机生成的秘密保存在被 Git 忽略的 `.wiser/local/runtime-secrets.json`。不要提交 `.env`、数据库 URL、S3 key、Supabase service-role、HMAC key、MCP token 或 Codex 登录文件。

浏览器只能接收 `NEXT_PUBLIC_SUPABASE_URL` 与 publishable key；数据库、对象存储、投影与 operator credential 必须保留在服务端。

## 日志、停止与重置

```bash
docker compose ps
docker compose logs --tail=200 api web worker docs data-worker mcp-http telemetry-ingress
pnpm data:logs
pnpm exec supabase status
pnpm data:down
pnpm observability:down
pnpm stack:down
```

`docker compose logs` 可以只保留本次失败的 service 名；服务未创建时先用 `docker compose ps -a`。Supabase 由 CLI 管理而不属于根 Compose project；`supabase status` 用于确认服务/端口，具体容器日志从本机 Docker runtime 查看。

| 操作                                      | 删除什么                                             | 保留什么                                                 |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `pnpm stack:down`                         | 只删除/停止容器                                      | Compose named volumes、Supabase 本机数据、`.wiser/local` |
| `pnpm supabase:reset` / `supabase:verify` | 重建 Supabase 控制面、Auth/EXCON schema 与 seed 数据 | Data Foundation volumes、`.wiser/local`                  |
| 确认式 `pnpm data:reset`                  | allowlist 内的 Data PostgreSQL/S3/投影 named volumes | Supabase、observability volumes、`.wiser/local`          |
| `pnpm observability:down`                 | 停止观测服务                                         | Tempo/Loki/Prometheus/Grafana named volumes              |

仓库没有“一键删除所有本机状态”的命令。`.wiser/local/runtime-secrets.json` 保存 EXCON journal 重放所需的历史 HMAC key，现有 journal 仍在时不得删除或只生成新 key。只有在所有服务停止、Supabase/EXCON journal 已明确重置且不需要恢复旧记录时，才可以按团队密钥轮换流程处理该文件；Data reset 本身不需要删除它。

若完整栈失败，先检查 Docker 资源、端口占用和失败服务日志，再重新运行可幂等收敛的 `pnpm stack:full:up`。

Data profile 构建 `source-parser`，它仅通过内部 `data-parser` 网络连接 Worker，不开放主机端口，不持有数据库凭据，也不能访问外网。文件系统只读，临时文件保存在有界内存中。本机单独运行 Worker 时可选配置 `DATA_ANALYSIS_PARSER_URL`；未配置时外部格式明确保持不可解析，完整 profile 自动配置。CI 在固定的 GDAL 镜像中运行解析测试。

## 语义嵌入与索引切换

API 与 Data Worker 必须使用相同的 `DATA_EMBEDDING_*` 配置。CI 和可复现 smoke 保留 `fake`；`NODE_ENV=production` 要求明确的真实 provider。Qwen3-Embedding-8B 通过 OpenAI 兼容的 `/v1/embeddings` 端点接入。服务地址配置在私有部署文件中；浏览器不接收地址或可选 API Key。

```dotenv
DATA_EMBEDDING_PROVIDER=openai-compatible
DATA_EMBEDDING_BASE_URL=http://embedding.internal:7710/v1
DATA_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
DATA_EMBEDDING_VERSION=1.0.0-qwen3
DATA_EMBEDDING_DIMENSIONS=4096
DATA_EMBEDDING_API_KEY=
DATA_EMBEDDING_TIMEOUT_MS=15000
```

`DATA_EMBEDDING_QUERY_INSTRUCTION` 省略或留空时使用已版本化的英文检索指令，仅用于查询。适配器要求返回模型一致，校验该配置下恰好 4,096 个有限且非全零的向量值，并执行归一化。每次最多 16 段文档，每段最多 32,768 字符，响应最多 4 MiB；超限明确失败，不写入截断向量。日志不记录输入或上游响应。

修改模型、修订号、维度或查询指令会派生新的 `WiserEvidenceChunkV3_*` 集合。修订号由运维管理：服务权重或预处理变化时增加版本。准备新集合时，API 继续使用旧配置。使用当前 case 的同一组 Compose 文件（包括 `compose.override.yaml`）启动重建；准备阶段只向重建进程注入新模型环境。

```bash
# Include the running case/runtime file as well when that deployment uses one.
docker compose -f compose.yaml -f compose.override.yaml run --rm --no-deps \
  data-worker pnpm --filter @wiser/data-worker exec tsx src/embedding-rebuild-cli.ts
```

CLI 使用 Worker 明确的租户、项目、安全等级和策略范围，以及每个配置/项目独立的 advisory lock、不可变权威证据、确定性投影 ID 和独立消费位点。它只写目标 Weaviate 集合与重建位点，不重置入库/发布状态，不重放其他投影。中断或失败的事件不推进位点；使用同一配置续跑。

持续运行的 Worker 也按配置的消费者名称和真实嵌入配置隔离位点。首次启动会分批核查保留的历史事件，即使共享投影台账已成功，也会向当前 Weaviate 集合写入证据；其他已成功的投影保持跳过。这一位点与重建位点独立，提前准备集合不会省去首次追赶的工作量。后续启动从该配置的持续消费位点续跑。fake 保留原位点以兼容本机样本及回退，真实配置不会推进该位点。

重建后先切换 Worker，等待其配置位点追上当前项目已提交的事件，核验全部证据覆盖、模型信息与中英文真实案例检索，再把 API 切换到相同配置。保留旧集合；回退也先恢复旧 Worker 配置，让它补齐停用期间发布的数据，确认覆盖后再恢复 API 配置。仅恢复配置不能证明索引完整。嵌入效果提升不会把来源登记内容变成科学证据。

高德官方适配器从 Web 服务端环境读取 `WISER_AMAP_KEY` 和 `WISER_AMAP_SECURITY_CODE`，保存在本机 `.env` 或部署秘密配置中。`/api/maps/amap/config` 仅在会话校验后返回公开 JS API Key。同源代理只允许地图样式和坐标转换，服务端注入安全密钥，限制响应大小并禁用缓存。安全密钥不得使用 `NEXT_PUBLIC_*` 变量；本机 Compose override 仍必须加载。

Data 纵切 smoke 为已登录 Web 目录页 GET 单独保留 60 秒请求预算，以容纳 Next.js 开发模式的首次编译。API 和登录请求仍使用默认 10 秒上限，所有请求继续受整轮 180 秒总期限约束。程序化选项 `webRequestTimeoutMs` 可收紧页面预算（100–60,000 毫秒）；超时不能算作页面断言成功。
