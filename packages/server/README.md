# @weysabi/server

OpenAI-compatible HTTP server for `@weysabi/client`. Runs as a drop-in replacement for the OpenAI API — same endpoints, same request/response format, but routes through Weysabi's provider failover, circuit breaker, and retry logic.

## Usage

```ts
import { createWeysabi } from "@weysabi/client";
import { createServer } from "@weysabi/server";

const sabi = createWeysabi({
  groq: { apiKey: process.env.SABI_GROQ_API_KEY },
});

const server = await createServer(sabi, { port: 3000 });
console.log(`Server on :${server.port}`);
```

Or via CLI:

```bash
sabi server --port 3000
```

## Endpoints

| Method | Path                   | Description            |
| ------ | ---------------------- | ---------------------- |
| POST   | `/v1/chat/completions` | Chat completion        |
| GET    | `/v1/models`           | List configured models |
| GET    | `/health`              | Health check           |

## Configuration

| Env Var                  | Default | Description                           |
| ------------------------ | ------- | ------------------------------------- |
| `SABI_PORT`              | `3000`  | HTTP server port                      |
| `SABI_API_KEY`           | —       | Bearer token auth (disabled if unset) |
| `SABI_CORS_ORIGINS`      | `*`     | Comma-separated CORS origins          |
| `SABI_RATE_LIMIT_RPM`    | `300`   | Per-IP rate limit (requests/minute)   |
| `SABI_GROQ_API_KEY`      | —       | Groq provider key                     |
| `SABI_OPENAI_API_KEY`    | —       | OpenAI provider key                   |
| `SABI_ANTHROPIC_API_KEY` | —       | Anthropic provider key                |
| `SABI_GOOGLE_API_KEY`    | —       | Google Gemini provider key            |
| `SABI_MISTRAL_API_KEY`   | —       | Mistral provider key                  |

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
- **Rate limiting**: Per-IP sliding window (configurable via `SABI_RATE_LIMIT_RPM`, default 300/min)
- **CORS**: Configurable origins via `SABI_CORS_ORIGINS` (comma-separated, default `*`)
- **No data leakage**: Provider API keys never exposed in responses
