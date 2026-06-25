# Repository Architecture

Weysabi is a Bun workspace with three packages:

| Package           | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `packages/sabi`   | Provider-agnostic AI orchestration SDK and `sabi` CLI        |
| `packages/server` | OpenAI-compatible Bun/Hono server and administration API     |
| `packages/webapp` | Static Next.js documentation and self-hosted admin interface |

Tests live beside source files as `src/*.test.ts`.

## Core SDK

Important modules in `packages/sabi/src`:

- `index.ts` — `WeysabiImpl` and `createWeysabi()`
- `types.ts` — Zod request schemas and public TypeScript contracts
- `providers.ts` — retries, circuit breaking, timeouts, and handler dispatch
- `providers/` — provider-specific handlers
- `prompts/` — typed prompt registry, rendering, and execution
- `rag/` — ingestion, embedding, HNSW search, and persistence
- `chat/` — conversation memory, SQLite/Postgres stores, and ChatSDK
- `guardrails/` — PII, injection, content, moderation, and output limits
- `cli/` — project setup and runtime commands

## Server

Important modules in `packages/server/src`:

- `routes.ts` — HTTP route composition
- `translate.ts` — OpenAI request/response translation
- `middleware.ts` — API-key auth, trusted proxies, and rate limits
- `quota.ts` — atomic token reservations and API-key fingerprints
- `ledger.ts` — bounded usage records and aggregate statistics
- `aliases.ts` — model alias resolution
- `index.ts` — `createServer()` and public server exports

Admin endpoints only exist when `SABI_ADMIN_API_KEY` or `adminApiKey` is configured.

## Webapp

`packages/webapp` uses Next.js 15, React 19, and Tailwind CSS 4. It is statically exported. Direct admin connection is for local or trusted self-hosted use; production deployments should proxy admin requests through an authenticated server-side application.

## Conventions

- Named exports only, except the `createWeysabi` default export
- Zod for runtime input validation
- Custom error classes for stable public failures
- Tests mock provider calls; do not make real API requests
- Structured logging via `createModuleLogger()`
- Preserve caller-owned injected stores
- Never expose provider keys or API-key prefixes

## Validation

```text
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun test packages/
bun run --cwd packages/webapp lint
bun run --cwd packages/webapp typecheck
bun run --cwd packages/webapp build
```
