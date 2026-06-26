# Changelog

## v0.9.0

### Added

- Server CLI, configurable host binding, model aliases, quotas, and usage accounting
- Dedicated `SABI_ADMIN_API_KEY` protection for admin routes
- Redis-injectable rate-limit and idempotency stores
- Next.js documentation site and self-hosted administration interface
- OpenAI compatibility for `max_completion_tokens`, `response_format`, and streaming usage

### Security

- API-key accounting uses full SHA-256 fingerprints instead of key prefixes
- Admin routes are absent unless explicitly enabled
- Admin credentials are not embedded in public variables or browser storage
- Admin query pagination and key filters are validated and bounded

### Fixed

- CLI init connectivity checks resolve credentials from the environment
- Server shutdown closes owned resources
- Idempotency keys reject reuse with a different request
- Client cancellation aborts upstream provider streams

## v0.7.1

### Added

- **Prompt management API** — `PromptDefinition` type + `Prompt` class with typed messages, schema, model, temperature. `sabi.prompts.register()` / `registerMany()` for structured prompt registration. `sabi.prompts.run(id, input, overrides?)` renders and executes through the full provider pipeline. `@weysabi/sabi/prompts` sub-path export
- **Weysabi Server** — `sabi server --port 3000` CLI command starts an OpenAI-compatible HTTP server. `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`. Supports streaming SSE and non-streaming JSON. `createServer(sabi)` programmatic API. `@weysabi/server` sub-path export
- **CLI init improvements** — model suggestions per provider, example prompt file scaffolding (classify, translate), automatic `.sabi/` entry in `.gitignore`
- **`SabiOptions.promptDefinitions`** — register initial prompts at construction time

### Changed

- `src/prompts.ts` replaced by `src/prompts/` directory with `Prompt`, `PromptRegistry`, `WeysabiPrompts`
- **Breaking**: removed `sabi.prompt()` / `sabi.render()` legacy API. Use `sabi.prompts.register()` / `sabi.prompts.render()` instead
- **Breaking**: removed `SabiOptions.prompts` (initial string templates). Use `SabiOptions.promptDefinitions` instead

## v0.7.0

### Added

- **Guardrails — output token limits** — `output.tokenLimit` config with `block`, `warn`, or `truncate` actions. Uses provider `completionTokens` when available, estimates by length otherwise
- **Guardrails — OpenAI Moderation API** — optional `moderationApiKey` integration for ML-powered content safety. Free tier, catches what regex misses. Gracefully falls back to regex on API failure
- **Guardrails — `sabi.guardrail()` API** — register custom validators with `scope: "input" | "output" | "both"`. `validate` returns `boolean` or `{ passed, message }`. Throws `GuardrailError` on violation
- **GuardrailMatch.action widened** — now `string` to support `"truncate"` alongside existing `block/redact/warn/passthrough`

- **Auto-routing sugar** — `model` accepts `string | string[]`. When an array, elements after the first become fallbacks. `model: ["groq/cheap", "openai/gpt-4o"]` chains automatically
- **ChatSDK** — `ChatSDK` class wraps `ConversationMemory` + `ChatAdapter` for prepare+call+record in one `chat()` / `stream()` call
- **ChatAdapter interface** — public interface, users write ~20 lines for any API. Ships OpenAI + Anthropic examples
- **`sabi/chat` exports** — `ChatSDK`, `OpenAIAdapter`, `AnthropicAdapter`, `ChatAdapter` type
- **Per-provider timeout & retry** — `ProviderConfig` accepts `timeout` and `retry` (statusCodes, maxRetries, backoffMs) that override global defaults per provider
- **`sabi/chat` sub-path export** — `import { ConversationMemory, SqliteSessionStore, PgSessionStore } from "@weysabi/sabi/chat"`
- **Pluggable store architecture** — `ConversationMemory` accepts any `StoreInterface` implementation
- **Session store** — `SqliteSessionStore` (SQLite) and `PgSessionStore` (Postgres) implementing shared `StoreInterface`
- **`postgres` peer dependency** — install when using `PgSessionStore`
- **Conversation memory** — `ConversationMemory` with persistent SQLite sessions, auto-truncation, system prompts
- **New design** — pure state manager (no `complete()` wrapper). `prepare()` returns context, user calls provider SDK natively, then `record()` persists the turn
- **RAG engine** — `RagEngine` with file ingestion, chunking, embedding, and HNSW-powered vector search
- **HNSW vector index** — in-memory approximate nearest neighbor with binary persistence to `.hnsw.vec` + `.hnsw.idx`
- **Multi-project manager** — `RagManager` with named project instances, shared providers, cross-project `queryAll()`
- **Query filters** — scope search by exact path, path prefix, or file ID
- **Embedding batch size** — configurable (default 512) to stay under API limits
- **Streaming ingestion** — `loadStream()` async generator yielding granular progress events
- **Object store abstraction** — `FsObjectStore`, `SqliteObjectStore`, BYO interface
- **WAL-mode SQLite** with 64MB cache, mmap, 64KB pages, configurable pragmas
- **`sabi/rag` sub-path export** — `import { RagEngine, RagManager, HnswVectorIndex } from "@weysabi/sabi/rag"`
