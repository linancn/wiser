# Agent EXCON Web

Read-only bilingual exercise observability UI built with Next.js, React and Tailwind CSS. Chinese is served at `/zh-CN`, English at `/en`, and `/` redirects to Chinese.

The default case is the fact-anchored synthetic 2023 Yongding River spring ecological replenishment exercise. The UI does not submit plans or advance episodes: agents run through Skills over the HTTP or MCP boundary. Browser data access is wrapped by the relative `/api/v1` read client, with a committed demo fixture when the API is unavailable.

```bash
pnpm --filter @agent-excon/web test
pnpm --filter @agent-excon/web typecheck
pnpm --filter @agent-excon/web build
pnpm --filter @agent-excon/web test:e2e
```
