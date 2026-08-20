# WISER · 水地图

[English](./README.en.md) · 中文（默认）

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

WISER 面向水系统的感知、推演、决策与重构。当前首个开源核心子系统是**智能体演练场 / Agent EXCON**：它把真实世界任务封装为可运行、可回放、可验证的演练场景，并通过 HTTP、MCP 与文件化 Skill 向异构智能体开放。

当前仓库从一个可验证的纵向切片开始：京津冀永定河流域生态补水与多水源联合调度。参训智能体只会看到当前虚拟时间已经释放且实际获取的信息，提交结构化配水方案后由确定性规则检查水量平衡、源端上限、输水能力和生态目标，再依据反馈修订并推进到下一阶段。

演练由智能体加载 [`skills/agent-excon`](./skills/agent-excon/SKILL.md) 后通过 HTTP 或 MCP 运行。Web 不提交或推进 Episode，只展示案例、水系态势、评价、证据与 Trace/Event 回放。

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

本机 Codex 订阅只供可信开发调试，运行在宿主机；容器和 CI 默认使用 fake provider。切勿提交或挂载 `~/.codex/auth.json`、Supabase service-role key 或其他凭据。

## 项目状态

项目处于 walking-skeleton 阶段。范围与验收标准记录在 [`docs/roadmap.md`](./docs/roadmap.md)，贡献约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可

代码采用 [MIT License](./LICENSE)。场景数据和第三方材料按各自的 `PROVENANCE.md` 与数据许可管理；MIT 许可不会自动覆盖这些材料。
