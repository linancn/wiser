# WISER Web

The shared WISER shell uses `@supabase/ssr` when `WISER_AUTH_MODE=supabase`. Next.js 16 `proxy.ts` calls `getClaims()` before rendering and propagates refreshed cookies to both the request and response with `Cache-Control: private, no-store`. Server Components use the cookie-backed server client; browser code receives only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key.

Read-only bilingual exercise observability UI built with Next.js 16 and React 19. Chinese is served at `/zh-CN`, English at `/en`, and `/` redirects to Chinese. Agents do not exercise from this UI: they participate through the versioned Skill over HTTP or MCP.

The Web has two explicit data modes:

| Mode        | Purpose                                                                 | Failure behavior                                               |
| ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `reference` | Default for deterministic builds and E2E; committed WISER design sample | Clearly labeled **Design preview**                             |
| `live`      | Server Components read the v2 operator projection with `cache:no-store` | Shows an actionable unavailable/error state; never uses sample |

```bash
# Default: committed design reference
AGENT_EXCON_WEB_DATA_MODE=reference pnpm --filter @wiser/web dev

# Live: values are read only by the Next.js server
AGENT_EXCON_WEB_DATA_MODE=live \
AGENT_EXCON_API_INTERNAL_URL=http://127.0.0.1:3001 \
WISER_WEB_OPERATOR_TOKEN=replace-with-a-dedicated-operator-token \
pnpm --filter @wiser/web dev
```

`AGENT_EXCON_API_INTERNAL_URL` must be a plain API origin, without `/api/v1` or `/api/v2`. `WISER_WEB_OPERATOR_TOKEN` must be a dedicated operator credential and must not use a `NEXT_PUBLIC_` prefix. It is attached only to server-side v2 requests and is never added by the Next rewrite or serialized into client props. Check API readiness at `/health/ready`.

Live reads use:

- public scenario catalog/detail/version endpoints under `/api/v2/scenarios`;
- operator `GET /api/v2/runs` and `GET /api/v2/runs/{runId}/agents`;
- operator `GET /api/v2/runs/{runId}/replay?perspective=operator`;
- operator `GET /api/v2/runs/{runId}/traces`.

The UI renders explicit coverage gaps when the current DTO cannot support a panel. It does not backfill scenario checkpoints or water topology from the reference sample, infer Agent identity/model/tool metadata from a RunAgent, fabricate span-level waterfalls from Trace summaries, or reconstruct participant replay perspectives from operator events.

The optional same-origin rewrites forward both `/api/v1/*` and `/api/v2/*` to the configured origin without injecting credentials. The current Web read source calls the v2 origin directly from Server Components; the v1 rewrite exists only for explicit compatibility clients.

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
```
