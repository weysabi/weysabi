# @weysabi/server

OpenAI-compatible HTTP server for `@weysabi/sabi`. It exposes OpenAI-style endpoints while routing requests through Weysabi's provider failover, circuit breaker, and retry logic.

## Usage

```ts
import { createWeysabi } from "@weysabi/sabi";
import { createServer } from "@weysabi/server";

const sabi = createWeysabi({
  groq: { apiKey: process.env.SABI_GROQ_API_KEY },
});

const server = await createServer(sabi, {
  port: 3000,
  hostname: "127.0.0.1",
});
console.log(`Server on http://${server.hostname}:${server.port}`);
```

Or via CLI:

```bash
sabi server --host 127.0.0.1 --port 3000
```

## Endpoints

| Method | Path                   | Description            |
| ------ | ---------------------- | ---------------------- |
| POST   | `/v1/chat/completions` | Chat completion        |
| GET    | `/v1/models`           | List configured models |
| GET    | `/health`              | Health check           |
| GET    | `/v1/admin/stats`      | Aggregate usage stats  |
| GET    | `/v1/admin/usage`      | Paginated usage data   |

## Configuration

| Env Var                  | Default   | Description                           |
| ------------------------ | --------- | ------------------------------------- |
| `SABI_PORT`              | `3000`    | HTTP server port                      |
| `SABI_HOST`              | `0.0.0.0` | HTTP server bind address              |
| `SABI_API_KEY`           | —         | Bearer token auth (disabled if unset) |
| `SABI_ADMIN_API_KEY`     | —         | Dedicated key enabling admin routes   |
| `SABI_CORS_ORIGINS`      | `*`       | Comma-separated CORS origins          |
| `SABI_RATE_LIMIT_RPM`    | `300`     | Per-IP rate limit (requests/minute)   |
| `SABI_MAX_BODY_BYTES`    | `1048576` | Maximum request body size             |
| `SABI_TRUSTED_PROXIES`   | empty     | Comma-separated direct proxy IPs      |
| `SABI_GROQ_API_KEY`      | —         | Groq provider key                     |
| `SABI_OPENAI_API_KEY`    | —         | OpenAI provider key                   |
| `SABI_ANTHROPIC_API_KEY` | —         | Anthropic provider key                |
| `SABI_GOOGLE_API_KEY`    | —         | Google Gemini provider key            |
| `SABI_MISTRAL_API_KEY`   | —         | Mistral provider key                  |

For multi-instance deployments, inject shared rate-limit and idempotency stores. Redis adapters are re-exported by `@weysabi/server`:

```ts
import {
  createServer,
  fromIORedis,
  RedisIdempotencyStore,
  RedisRateLimitStore,
} from "@weysabi/server";

const redisClient = fromIORedis(redis);
const server = await createServer(sabi, {
  rateLimitStore: new RedisRateLimitStore(redisClient),
  idempotencyStore: new RedisIdempotencyStore(redisClient),
});
```

Injected stores remain caller-owned and are not disposed by `server.stop()`.

## Deployment

### Docker

```bash
docker build -t weysabi-server -f packages/server/Dockerfile .
docker run -p 3000:3000 \
  -e SABI_GROQ_API_KEY=gsk-... \
  -e SABI_API_KEY=sk-weysabi-secret \
  weysabi-server
```

### Railway

1. Connect your repo
2. Set build command: `bun install`
3. Set start command: `bun run packages/server/src/start.ts`
4. Add env vars: `SABI_GROQ_API_KEY`, `SABI_API_KEY`, etc.
5. Deploy — Railway detects the Bun runtime automatically

### Fly.io

```dockerfile
# Use the included Dockerfile
fly launch --dockerfile packages/server/Dockerfile
fly secrets set SABI_GROQ_API_KEY=gsk-... SABI_API_KEY=sk-...
fly deploy
```

### Render

1. Create a new Web Service
2. Build command: `bun install`
3. Start command: `bun run packages/server/src/start.ts`
4. Set env vars in the dashboard
5. Render auto-detects Bun from the lockfile

## Security

- **Auth**: Set `SABI_API_KEY` to require `Authorization: Bearer <key>` on all endpoints except `/health`
- **Rate limiting**: Per-IP fixed-window limiting (configurable via `SABI_RATE_LIMIT_RPM`, default 300/min)
- **Distributed state**: Shared rate-limit and idempotency stores can be injected for multi-instance deployments
- **Idempotency safety**: Reusing a key with a different request returns `409` instead of stale data
- **Proxy safety**: Forwarded IP headers are ignored unless the direct peer appears in `SABI_TRUSTED_PROXIES`
- **Body limits**: Completion requests are capped by `SABI_MAX_BODY_BYTES`
- **Disconnect handling**: Client cancellation aborts the upstream provider stream
- **CORS**: Configurable origins via `SABI_CORS_ORIGINS` (comma-separated, default `*`)
- **No data leakage**: Provider API keys never appear in responses
