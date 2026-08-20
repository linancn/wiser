---
title: HTTP API
description: Agent EXCON v1 的资源、幂等、状态与错误约定。
---

## 协议角色

HTTP API 是唯一业务协议底座。Web、客户端 SDK、Skill 脚本和 MCP Server 都调用它，不直接访问领域表。

基础路径为 `/api/v1`。破坏性字段或语义变化必须发布新主版本；新增可选字段不改变 v1。

## 核心资源

| 方法   | 路径                                     | 作用                            |
| ------ | ---------------------------------------- | ------------------------------- |
| `POST` | `/episodes`                              | 从固定 ScenarioVersion 创建演练 |
| `GET`  | `/episodes/{episodeId}`                  | 获取状态与当前虚拟时间          |
| `POST` | `/episodes/{episodeId}/observe`          | 交付已释放信息并记录实际访问    |
| `GET`  | `/episodes/{episodeId}/observations`     | 获取当前参与者已经获得的观察    |
| `POST` | `/episodes/{episodeId}/submissions`      | 创建不可变提交版本              |
| `GET`  | `/submissions/{submissionId}`            | 获取指定不可变修订              |
| `GET`  | `/submissions/{submissionId}/evaluation` | 获取评价状态与结果              |
| `GET`  | `/episodes/{episodeId}/feedback`         | 获取当前可见反馈                |
| `POST` | `/episodes/{episodeId}/advance`          | 授权推进虚拟时间或阶段          |
| `GET`  | `/episodes/{episodeId}/events`           | 分页读取可见事件流              |

## 创建 Episode

```http
POST /api/v1/episodes
Authorization: Bearer <participant-token>
Idempotency-Key: 91a8f390-...
Content-Type: application/json
```

```json
{
  "scenarioVersionId": "jjj-yongding-replenishment-2023-v1",
  "participantVersionId": "22222222-2222-4222-8222-222222222222"
}
```

成功返回 `201`；相同主体、路径和幂等键重试返回同一资源。幂等键复用但请求体不同，返回 `409`。

## Observe、提交与推进

三类写操作都携带 UUID `Idempotency-Key` 和最近一次返回的 Episode version：

```json
// POST /episodes/{id}/observe
{ "episodeVersion": 1 }

// POST /episodes/{id}/submissions
{
  "episodeVersion": 2,
  "plan": {
    "stage": 1,
    "sourceReleases": [
      {
        "sourceId": "guanting",
        "flowM3s": 20,
        "evidenceRefs": ["official-flow-20230322-guanting"]
      }
    ],
    "expectedSectionFlows": [
      { "sectionId": "sanjiadian", "flowM3s": 18 }
    ],
    "isFinal": false
  }
}

// POST /episodes/{id}/advance
{ "episodeVersion": 5 }
```

上例为 envelope 示意；实际方案必须包含三个水源和四个断面，并通过共享 Zod 契约。第二阶段最终方案仍通过 `advance` 完成 Episode，不另设 finalize 路由。提交响应包含 `submissionId`、同步确定性 `evaluation`、`feedback` 和对账链接；可用 `GET /submissions/{id}/evaluation` 安全重试查询。

## 响应与错误

成功响应直接返回类型化资源。错误使用稳定 envelope：

```json
{
  "error": {
    "code": "EVIDENCE_NOT_OBSERVED",
    "message": "提交引用了当前参与者尚未获得的证据。",
    "traceId": "01J...",
    "details": {
      "claimId": "release-plan-01"
    }
  }
}
```

`details` 只能包含调用方已经有权知道的信息。对于未释放对象，响应不能确认它是否存在。

| 状态码 | 含义                             |
| ------ | -------------------------------- |
| `401`  | 缺少或无效身份                   |
| `403`  | 已知资源上的操作不被允许         |
| `404`  | 资源不存在或调用方无权知道其存在 |
| `409`  | 状态转换、版本或幂等冲突         |
| `422`  | Schema、字段范围或领域规则失败   |
| `429`  | 限流；附 `Retry-After`           |

## 并发和一致性

写操作校验 Episode 当前版本；持久化实现必须在数据库事务内锁定对应行，并让状态变化与 Event 同时提交。

列表接口使用稳定 cursor，不使用会因新事件插入而漂移的页码。

## 认证

Web 用户使用 Supabase Auth 会话；外部智能体使用可撤销、可散列存储、带作用域的 token。任何 service-role 或数据库凭据都不能交给参训智能体。

常用 scope 示例：`episode:create`、`observation:read`、`submission:create`、`feedback:read`。管理员推进和人工裁决使用独立 scope。
