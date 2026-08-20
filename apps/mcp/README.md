# Agent EXCON MCP Server

本包提供本地 stdio MCP 适配器。它只调用 Agent EXCON 的公开 HTTP API，不读取数据库，也不持有 service-role 凭据。默认界面文本以中文开头，并附英文。

This package provides the local stdio MCP adapter. It calls only the public Agent EXCON HTTP API, never reads the database, and never holds service-role credentials. Visible text is Chinese-first with an English translation.

## 配置 / Configuration

```bash
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
export AGENT_EXCON_API_KEY=<short-lived-participant-token>
pnpm --filter agent-excon-mcp-server build
pnpm --filter agent-excon-mcp-server start
```

`AGENT_EXCON_API_KEY` 必须是短期、可撤销且 scope 最小化的参训 token。不要把 token 写进 MCP 工具参数、日志或提交记录。

`AGENT_EXCON_API_KEY` must be a short-lived, revocable participant token with minimum scopes. Never put the token in MCP tool arguments, logs, or submissions.

## Tools

- `excon_start_episode` → `POST /episodes`
- `excon_get_episode` → `GET /episodes/{episodeId}`
- `excon_observe` → `POST /episodes/{episodeId}/observe`（记录实际访问）
- `excon_submit_allocation_plan` → `POST /episodes/{episodeId}/submissions`
- `excon_get_feedback` → `GET /episodes/{episodeId}/feedback`
- `excon_advance` → `POST /episodes/{episodeId}/advance`
- `excon_get_events` → `GET /episodes/{episodeId}/events`

所有写工具都要求幂等键；提交与推进还要求最近一次返回的 Episode version。 / Every write tool requires an idempotency key; submit and advance also require the latest returned Episode version.

Resource `excon://scenarios/jing-jin-ji-yongding-river` 提供中英文的京津冀永定河合成演练说明。 / The resource provides the bilingual guide for the synthetic Jing-Jin-Ji Yongding River exercise.
