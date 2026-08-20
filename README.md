# WISER · 水地图

[English](./README.en.md) · 中文（默认）

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

WISER 面向水系统的感知、推演、决策与重构。当前首个开源核心子系统是**智能体演练场 / Agent EXCON**：它把真实世界任务封装为可运行、可回放、可验证的演练场景，并通过 HTTP、MCP 与文件化 Skill 向异构智能体开放。

仓库从一个可验证的单智能体兼容纵切开始：京津冀永定河流域生态补水与多水源联合调度。当前 v2 目标已升级为多场景、多角色团队演练：水情证据、水动力约束、生态目标与调度协调智能体获得不同信息、并行完成任务，以显式工件汇流成团队方案，再分别获得个人、角色和团队反馈。

演练由智能体加载 [`skills/agent-excon`](./skills/agent-excon/SKILL.md) 后通过 HTTP 或 MCP 运行。Web 不模拟智能体参训；它负责多场景管理、导调态势、按 Agent 的 OTel 式 Trace 和基于领域事件/Receipt 的当时视角回放。

## 工程原则

- 真实用例驱动的 Red → Green → Refactor；每个行为先由测试定义。
- 确定性裁决优先；AI 只生成解释性摘要，不决定分数或最终裁决。
- 本机开发调试默认复用 `codex login`，CI 与部署使用 fake 或 OpenAI-compatible provider。
- Supabase 提供 Auth、PostgreSQL、Storage 与本地开发工具；复杂事务使用 `pg` + SQL。
- PostgreSQL 状态表承担初期异步任务，不引入 Redis 或额外消息队列。
- 中文界面和文档为默认，英文内容保持一一对应。

## 目标中的仓库结构

```text
apps/          HTTP API、只读 Web、Worker、MCP 与 Starlight 文档
packages/      协议、纯领域核心与基础设施适配器
scenarios/     版本化演练场景及来源清单
skills/        可独立发布的 Agent EXCON Skill
supabase/      配置、迁移、种子与数据库测试
tests/         跨边界验收测试
```

## 环境基线

- Node.js 24 LTS（推荐 `24.19.0`，兼容范围 `>=24.18.0 <25`）
- pnpm 11
- Docker Engine 29+ / Docker Compose 5+
- Codex CLI（本机开发的默认 AI provider）

安装并验证：

```bash
corepack enable
pnpm install
pnpm verify
```

启动完整开发栈：

```bash
pnpm stack:up
```

这会先由 Supabase CLI 启动 Auth/PostgreSQL 17/Storage/Studio，再由 Compose 启动 API、只读 Web、Worker 和文档。默认地址为 Web `:3000`、API `:3001`、Worker health `:3002`、文档 `:4321`、Supabase Studio `:56323`。停止使用 `pnpm stack:down`。

按需启动本地技术观测栈：

```bash
pnpm observability:up
```

它在回环地址提供 OTLP `:4317/:4318`、Grafana `:3300` 和 Prometheus `:9090`，并用 Tempo/Loki 保存本地 Trace/Log。`pnpm observability:down` 只停止这些服务并保留命名卷。Collector 是可信本地入口；生产参训者 Telemetry 仍必须经过绑定 RunAgent 身份的认证 Ingress。

本机 Codex 订阅只供可信开发调试，运行在宿主机；容器和 CI 默认使用 fake provider。切勿提交或挂载 `~/.codex/auth.json`、Supabase service-role key 或其他凭据。

## 项目状态

v1 walking skeleton 已可运行，v2 正按 TDD 迁移到多场景、多智能体和可观测导调。范围与验收标准记录在 [`docs/roadmap.md`](./docs/roadmap.md)，完整设计见 [`docs/design/v2-multi-scenario-multi-agent-observability.md`](./docs/design/v2-multi-scenario-multi-agent-observability.md)，贡献约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可

代码采用 [MIT License](./LICENSE)。场景数据和第三方材料按各自的 `PROVENANCE.md` 与数据许可管理；MIT 许可不会自动覆盖这些材料。
