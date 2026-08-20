---
title: MCP 接入
description: 将稳定 HTTP 操作暴露为可发现、可约束的 MCP Tools 与 Resources。
---

## MCP 是适配器

MCP Server 调用公开 HTTP API，不复制状态机、权限或裁决逻辑，也不使用数据库 service-role 绕开参训协议。这样 HTTP、SDK 与 MCP 得到相同结果和审计事件。

当前采用 `@modelcontextprotocol/sdk` v1 稳定线。远程部署使用 Streamable HTTP；由本地客户端拉起的进程使用 stdio。旧 HTTP+SSE transport 不用于新实现。

## 核心 Tools

| Tool                     | HTTP 操作                          | 注解                 |
| ------------------------ | ---------------------------------- | -------------------- |
| `excon_start_episode`    | `POST /episodes`                   | 非只读、幂等、非破坏 |
| `excon_get_observation`  | `GET /episodes/{id}/observations`  | 只读                 |
| `excon_submit_result`    | `POST /episodes/{id}/submissions`  | 非只读、幂等         |
| `excon_get_evaluation`   | `GET /submissions/{id}/evaluation` | 只读                 |
| `excon_get_feedback`     | `GET /episodes/{id}/feedback`      | 只读                 |
| `excon_advance_episode`  | `POST /episodes/{id}/advance`      | 非只读、需授权       |
| `excon_finalize_episode` | `POST /episodes/{id}/finalize`     | 非只读、显式确认     |

Tool 输入和 `structuredContent` 直接来自 `packages/contracts` 的 Zod schema。文本 `content` 只提供简短的人类摘要，机器不应从摘要反向解析字段。

## Resources

稳定、只读且适合按 URI 获取的内容可以暴露为 Resource：

```text
excon://episodes/{episodeId}
excon://episodes/{episodeId}/observations/latest
excon://submissions/{submissionId}/evaluation
```

隐藏 Outcome、内部评价规则和未释放 Inject 不是 Resource。

## 身份和错误

远程 MCP 使用与 HTTP API 对应的 OAuth/token scope。stdio 模式从进程环境读取短期 token；不把 token 写进 Tool 参数、日志或模型上下文。

HTTP 错误码映射为 `isError: true` 的 Tool 结果，并保留稳定 `code`、安全的 `details` 和 `traceId`。错误描述给出下一步，但不能泄露隐藏事实。

## Codex 的两个角色

Codex 可以作为参训智能体，通过这些 Tools 完成演练；也可以作为开发期代码智能体维护本项目。两种身份、凭据和事件记录不能混用。模型辅助评价则是第三种受控角色，必须通过独立 evaluator adapter 调用。

## 契约测试

每个 Tool 使用与 HTTP 测试相同的 fixtures，并验证：

- 输入约束与 HTTP schema 一致；
- 成功结果的 `structuredContent` 不丢字段；
- 错误不泄露未授权数据；
- 重试不会重复创建资源；
- Tool 注解与真实副作用一致。
