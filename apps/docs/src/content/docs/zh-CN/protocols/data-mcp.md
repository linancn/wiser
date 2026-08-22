---
title: Data MCP 接入
description: 通过共享 WISER MCP Gateway 调用 22 项 Data Capability 与 5 类受控 Resource。
docType: protocol-reference
scope: data-mcp-adapter
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 通过 MCP 查询或入库 Data Foundation 时
  - 修改 Data MCP Tool、Resource、HTTP mapping 或 transport 时
whenToUpdate:
  - Tool、Resource、凭据、响应上限或 API mapping 变化时
checkPaths:
  - apps/mcp/src/data-foundation/**
  - apps/api/src/data-foundation/**
  - packages/data-contracts/src/capability/**
  - skills/wiser-data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 76f3f6d4967c0f7fc13b06ca1480244121a90272
---

## 只做 HTTP 适配

Data MCP 是现有 WISER MCP Gateway 的静态 `WiserMcpModule`，不是第二套业务实现。stdio 与无状态 Streamable HTTP 都调用 `/api/data/v1`，从不连接 data-postgres、SeaweedFS 或任一投影，也不持有 Supabase service-role key。

模块从 `@wiser/data-contracts` 的有序 Registry 注册 22 个 strict Zod Tool。Tool name、输入 schema、query/command 注解和 REST mapping 在运行时来自同一 Capability definition；不存在 AST 扫描、通用 SQL/Cypher/DSL Tool 或自动发现的数据库命令。

## Data API 配置

完整配置五项必须一起出现；全部缺失时只启动 Agent EXCON MCP，部分配置会失败关闭：

```bash
export DATA_API_URL=http://127.0.0.1:3001/api/data/v1/
export DATA_API_BEARER_TOKEN=<supabase-jwt-or-wdc1-delegated-credential>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console
```

`DATA_API_URL` 必须是 `http/https`、无 userinfo/query/fragment，并以 `/api/data/v1/` 结束。Bearer 长度为 16–8192 字符且不能包含控制字符。Tenant/Project 必须是 UUID，Purpose 必须是有界安全标识。

本地 stdio：

```bash
pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

同一 Gateway 可以同时注册 EXCON 与 Data 模块；二者使用各自的 API bearer 和身份绑定，不能互相替代。

## Streamable HTTP

Compose 在 `http://127.0.0.1:13004/mcp` 运行无状态入口。独立启动：

```bash
export DATA_MCP_BEARER_TOKEN=<random-secret-at-least-16-characters>
export DATA_MCP_HOST=127.0.0.1
export DATA_MCP_PORT=3004

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start:http
```

有两层不同 credential：

1. `DATA_MCP_BEARER_TOKEN` 只用 timing-safe digest 比较保护 `POST /mcp` 边界；
2. `DATA_API_BEARER_TOKEN` 是下游 REST 请求的统一 WISER identity。

禁止把任一 token 放进 query、Tool 参数、Resource URI、日志、Telemetry 或 Git。`GET /health/live` 与 `/health/ready` 无需认证且禁止缓存；优雅关闭先让 ready 变为 false，再排空在途请求。每个 `/mcp` 请求创建新 server/transport，当前入口不签发或恢复 MCP session。

## 22 个 Tools

| MCP Tool                       | Capability                    | 类型    |
| ------------------------------ | ----------------------------- | ------- |
| `data_catalog_search`          | `data.catalog.search`         | query   |
| `data_catalog_get`             | `data.catalog.get`            | query   |
| `data_query`                   | `data.query`                  | query   |
| `data_search_federated`        | `data.search.federated`       | query   |
| `data_knowledge_search`        | `data.knowledge.search`       | query   |
| `data_graph_expand`            | `data.graph.expand`           | query   |
| `data_graph_find_path`         | `data.graph.findPath`         | query   |
| `data_geo_query`               | `data.geo.query`              | query   |
| `data_geo_intersect`           | `data.geo.intersect`          | query   |
| `data_ingestion_create`        | `data.ingestion.create`       | command |
| `data_ingestion_submit`        | `data.ingestion.submit`       | command |
| `data_operation_get`           | `data.operation.get`          | query   |
| `data_catalog_create`          | `data.catalog.create`         | command |
| `data_catalog_versions_list`   | `data.catalog.versions.list`  | query   |
| `data_catalog_version_get`     | `data.catalog.versions.get`   | query   |
| `data_upload_session_create`   | `data.uploadSession.create`   | command |
| `data_upload_session_complete` | `data.uploadSession.complete` | command |
| `data_ingestion_get`           | `data.ingestion.get`          | query   |
| `data_ingestion_approve`       | `data.ingestion.approve`      | command |
| `data_ingestion_reject`        | `data.ingestion.reject`       | command |
| `data_operation_cancel`        | `data.operation.cancel`       | command |
| `data_operation_events`        | `data.operation.events`       | query   |

Query 使用 `readOnlyHint=true`；command 明确为非只读、幂等、非破坏性 open-world 操作。每个 command 输入在 Capability schema 上增加 UUID `idempotencyKey`。版本化 command 还携带 `expectedVersion`，适配器把它变为强 `If-Match: "vN"`，不把 transport 字段混入 JSON body。

GET Tool 只编码 boolean、number、string 或 string array query；path parameter 逐段 URL 编码。其他值在发 HTTP 前失败。SSE Operation event 会被有界解析为 `{ items, nextCursor? }`，便于不支持原始 SSE 的 Agent 客户端对账。

## 推荐调用流程

### 查询

1. 用 `data_catalog_search` 获取已授权 DataItem 和 cursor；
2. 用 `data_catalog_get`/`data_catalog_version_get` 固定不可变 `versionId`；
3. 选择 `data_query`、`data_search_federated`、`data_knowledge_search`、graph 或 geo Tool；
4. 检查每个结果的 `versionId`、`evidenceId`、security、quality、acceptance 与 limitations；
5. 不把搜索 score 当作质量或授权结论。

### 入库

1. `data_upload_session_create` 生成 quarantine 上传计划；
2. 调用方在 MCP 外使用受控预签名 URL 上传大文件；
3. `data_upload_session_complete` 核对对象；
4. `data_ingestion_create` 后 `data_ingestion_submit`；
5. 轮询 `data_operation_get`/`data_operation_events`；
6. 只有具备 `data.publish` 的 steward 在 `WAITING_REVIEW` 使用 approve/reject；
7. 状态到 `SUCCEEDED`/`PUBLISHED` 后再查询固定版本。

长任务 Tool 返回共享 `operationId`，不会在 MCP 请求中等待整个入库或投影过程。Gateway 从顶层或嵌套 `operation.operationId` 派生同一个 `operation://` URI，并把它放在成功结果的顶层 `structuredContent.resource`，便于跨 Tool/Resource 恢复。

## Resources

Gateway 注册五类模板；每次读取都通过同一个 Data API bearer、Tenant、Project 与 Purpose 重新授权：

| URI template                                       | 内容                                   |
| -------------------------------------------------- | -------------------------------------- |
| `data://items/{dataItemId}/versions/{versionId}`   | 精确不可变 DataItemVersion             |
| `evidence://fragments/{evidenceId}`                | 受授权的证据片段                       |
| `operation://{operationId}`                        | Operation 当前状态                     |
| `schema://capabilities/{capabilityId}/{version}`   | 固定 Capability schema/mapping         |
| `stac://collections/{collectionId}/items/{itemId}` | 受授权 STAC Item 与治理后的 asset href |

URI segment 只接受安全字母数字与 `._:-`，不允许斜线、遍历、query 或 credential。Evidence 与 STAC Resource 分别经真实 `/evidence/fragments/:evidenceId` 和 `/stac/collections/:collectionId/items/:itemId` GET 重新执行 Scope、RLS、权威复核与 audit；STAC asset 只指向短期授权下载路由。Resource 返回 `application/json`；无效引用或下游不可用使用安全错误对象，不回显内部 HTTP/数据库正文。

## 响应与上限

成功结果同时提供：

- 中文优先的 `content`，包含紧凑 `MACHINE_DATA`；
- 同一份机器可读 `structuredContent = { ok: true, data, resource? }`；存在合法 Operation ID 时，`resource` 精确为 `operation://<uuid>`。

完整 MCP 结果超过 32,000 字符时返回 `MCP_RESPONSE_TOO_LARGE`，不截断后伪装成完整事实。收窄 `first`、filter 或 cursor。下游 HTTP 正文最大 1 MiB，单个 SSE snapshot 最多 10,000 events，并受每次请求 timeout 保护。

适配器不会把 Data API 的内部 `details`、Bearer 或后端正文转发给 Agent。Tool 调用保留两类可安全行动的身份语义：

| 下游 HTTP | `structuredContent.error.code` | 安全恢复动作                                                        |
| --------- | ------------------------------ | ------------------------------------------------------------------- |
| `401`     | `NOT_AUTHENTICATED`            | 刷新或重新配置短期 Data API credential                              |
| `403`     | `NOT_AUTHORIZED`               | 核对 Tenant、Project、Purpose、Scope 与安全等级；不能靠重试扩大权限 |

其他网络、5xx、契约和未分类失败统一为不泄密的 `DATA_API_ERROR`：

```json
{
  "ok": false,
  "error": {
    "code": "DATA_API_ERROR",
    "message": "数据基座 API 暂时无法完成请求。 / The Data Foundation API could not complete the request.",
    "action": "核对身份、范围与 Operation 状态后安全重试。 / Reconcile identity, scope, and Operation status before a safe retry."
  }
}
```

这一区分只保留身份类别，不传递 API `details`、资源存在性或 Scope 内部清单。MCP Resource 读取仍把下游失败收敛为安全 `DATA_RESOURCE_UNAVAILABLE`，避免通过 Resource error surface 推断隐藏资源。

## 安全重试

Query 用相同 cursor/filters 重试。Command 只能用相同 principal、Tenant、Project、Purpose、Tool、arguments 与 `idempotencyKey` 重试；版本化 command 的 `expectedVersion` 也必须不变。模糊失败后用 `data_operation_get` 或最小 catalog/ingestion GET 对账，不生成新 key 盲目重复。

MCP 不替调用方保存 bearer、upload id、multipart ETag 或 Operation cursor。调用方负责把这些状态保存在受保护、可恢复且不会进入 Agent 可见正文的位置。
