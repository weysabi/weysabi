# Weysabi — Product Plan

**Repository**: `github.com/weysabi/sabi`
**Package**: `@weysabi/sabi`
**Domain**: `weysabi.co`

## Vision

Weysabi makes building AI products boring. One library. Your own API keys. Provider failover, prompt management, structured output, RAG, streaming, evals, cost tracking, and observability — all in one place.

For fullstack devs who don't have an ML team. You know your stack (TypeScript, React, Postgres). Weysabi adds AI to it.

## Core Philosophy

- **Single dependency.** Not LangChain + Pinecone + provider SDKs + eval framework. Just `@weysabi/sabi`.
- **Your keys, your providers.** Weysabi never marks up tokens. You pay OpenAI/Groq/Anthropic directly. Weysabi charges for orchestration — versioning, evals, monitoring, team sync.
- **Zero config for common cases.** RAG? Point at a PDF. Structured output? Pass a Zod schema.
- **Works offline-first.** No cloud required. Cloud adds versioning, evals, monitoring, team.
- **TypeScript everything.** Autocomplete, type safety, no runtime surprises.
- **No lock-in.** Stop paying, the library still works.

## Business Model

### Phase 1 — Orchestration Only (Now)

Users bring their own API keys. Weysabi routes, fails over, retries, manages prompts. Revenue from cloud features.

```
sabi.complete({ model: "groq/llama-4-scout", ... })
  → sends directly to Groq's API
  → Weysabi never sees the request body
  → you pay Groq, not Weysabi
```

### Phase 2 — Hosted Inference (Future)

Weysabi hosts open-source models (Llama, Mistral, DeepSeek). Users use `sabi/llama-4-scout` — Weysabi runs inference, charges per token. Cheaper than Groq/Together (no middleman).

### Phase 3 — Smart Routing (Future)

Weysabi routes simple tasks to cheap hosted models, complex tasks to GPT-4/Claude. One bill.

The orchestration layer is the moat. By the time hosted inference launches, users already trust the routing.

## Implementation Phases

### Phase 0 — Core Library (Shipped as v0.3.0)

- [x] Provider abstraction (OpenAI-compatible API, any provider)
- [x] Prompt templates with `{variable}` syntax
- [x] Circuit breaker (configurable threshold, cooldown, window)
- [x] Retry with exponential backoff (configurable status codes)
- [x] Provider failover (model → fallbacks array)
- [x] Zod for runtime validation

### Phase 1 — Streaming (Shipped as v0.4.0)

- [x] `sabi.stream()` returning `AsyncIterable<StreamChunk>`
- [x] Support both SSE and raw streaming from providers
- [x] `StreamChunk` type: `{ content: string, usage?: Usage, done: boolean }`
- [x] Auto-detects provider streaming format (OpenAI-style vs Anthropic-style)
- [x] Framework adapters: `sabi/sse`, `sabi/hono`, `sabi/next`, `sabi/express`, `sabi/fastify`, `sabi/elysia`
- [x] Client-side: `sabi.readStream(response.body)` for consuming

### Phase 2 — More Providers (Shipped as v0.4.0)

- [x] Anthropic provider (Claude API) — `src/providers/anthropic.ts`
- [x] Google Gemini provider — `src/providers/google.ts`
- [x] OpenAI-compatible handler covers Groq, Nvidia, DeepSeek, OpenRouter, Together via `baseUrl`
- [x] Mistral AI provider (dedicated handler) — `src/providers/mistral.ts`
- [x] Ollama provider (local models, zero config) — `src/providers/ollama.ts`

### Phase 3 — Structured Output (Shipped as v0.4.0)

- [x] `schema` on `CompleteRequest` — validates with Zod, returns `parsed` on response
- [x] Auto-retry on parse failure (`schemaMaxRetries`, default 3)
- [x] `SchemaValidationError` with `.raw` and `.issues`
- [x] Works with any Zod schema
- [x] Cost-aware: tries primary model first, uses `fallbacks` on failure

### Phase 4 — Telemetry & Observability (v0.5.0)

- [x] `onAttempt` callback before each provider attempt
- [x] `onSuccess` callback with response + metadata
- [x] `onFailure` callback with error + metadata
- [x] `onFallback` callback on failover
- [x] Cost estimation — `estimatedCostUsd` in every response
- [x] OpenTelemetry integration pattern (`sabi/otel`)
- [x] Pluggable cache adapter (`InMemoryCache`, `RedisCache`, BYO `CacheAdapter`)

### Phase 5 — Distribution (v0.8.0)

- [x] Vercel AI SDK adapter (`sabi/ai-sdk`) — `LanguageModelV3`-compatible, `ProviderV3`
- [ ] Get listed on `ai-sdk.dev/providers/community-providers`
- [x] CLI: `bunx sabi <command>` — `init`, `config validate`, `complete`, `stream`, `prompt {list,add,rm}`, `benchmark`, `doctor`
- [x] Middleware/plugin system — `sabi.use(plugin)` with lifecycle hooks

### Phase 6 — RAG & Memory (v0.7.0)

- [x] `RagEngine` — ingest files, directories, raw text; query with vector search
- [x] `RagManager` — multi-project lifecycle, cross-project `queryAll()`
- [x] Local vector store (SQLite + HNSW, zero deps) — persists as `.hnsw.idx` + `.hnsw.vec`
- [x] Embedding support — `embedText()` / `embedBatch()` with configurable batch size
- [x] Query filters — `path`, `pathPrefix`, `fileId` scoping
- [x] Streaming ingestion — `loadStream()` yields progress events
- [x] WAL-mode SQLite, 64KB pages, mmap, configurable pragmas
- [x] Pluggable object store (`FsObjectStore`, `SqliteObjectStore`, BYO)
- [x] `ConversationMemory` — provider-agnostic session persistence + auto‑truncation
- [x] `StoreInterface` — pluggable backend: SQLite (default), Postgres (BYO `postgres` client), or custom
- [ ] Automatic summarization for long conversations (deferred — see PHASES.md)
- [ ] PDF / URL ingestion (deferred — see PHASES.md)

### Phase 7 — Guardrails ✅ SHIPPED

- [x] PII redaction (emails, phones, SSNs, credit cards, API keys, IPs)
- [x] Prompt injection detection (jailbreaks, system prompt extraction, delimiter confusion)
- [x] Topic blocking (hate, harassment, violence, sexual, self-harm)
- [x] OpenAI Moderation API integration (free, catches what regex misses)
- [x] Output token limits (block, warn, truncate)
- [x] Custom guardrails — `sabi.guardrail("name", { validate, onViolation })`

### Phase 8 — Prompt Management ✅ SHIPPED

- [x] `Prompt` class — typed definition with messages, schema, model, temperature, maxTokens
- [x] `sabi.prompts.register(def)` / `sabi.prompts.registerMany(defs)` — structured prompt registration
- [x] `sabi.prompts.run(id, input, overrides?)` — render + execute through full provider pipeline
- [x] `Prompt.render(input)` — renders `{variable}` in message content
- [x] `PromptDefinitionSchema` — Zod validation for prompt definitions
- [x] `@weysabi/sabi/prompts` sub-path export
- [x] Backward compatible — `sabi.prompt()` / `sabi.render()` continue working
- [x] Initial prompt definitions via `SabiOptions.promptDefinitions`
- [ ] File-based `.prompt.yaml` loading (deferred — see PHASES.md)

### Phase 9 — Weysabi Server ✅ SHIPPED

- [x] `POST /v1/chat/completions` — OpenAI-compatible, stream + non-stream
- [x] `GET /v1/models` — list configured models
- [x] `GET /health` — health check
- [x] `sabi server --port 3000` CLI command
- [x] `createServer(sabi)` programmatic API
- [x] Env-var config via `SABI_PORT`, `SABI_*_API_KEY`
- [x] `@weysabi/server` sub-path export

### Phase 10 — Eval Suites (v1.2.0)

- [ ] `sabi.eval.createSuite("name")` — create test suites
- [ ] `suite.addCase({ prompt, inputs, expected })` — add test cases
- [ ] `suite.run({ model })` — run all cases, get pass/fail
- [ ] CI gate: `sabi eval check --min-pass=90`

### Phase 11 — Cloud Dashboard (v2.0.0)

- [ ] Prompt management (CRUD, versioning, diff, rollback)
- [ ] Usage analytics (requests, tokens, cost by model/user/time)
- [ ] Eval suite dashboard (history, regression alerts)
- [ ] RAG document management
- [ ] Full trace logs (prompt, response, latency, cost)
- [ ] Team features (shared prompts, API keys, roles, audit log)
- [ ] Auth (JWT-based, admin users, sessions)

### Phase 12 — Hosted Inference (v3.0.0)

- [ ] GPU infra for open-source models
- [ ] `sabi/llama-4-scout`, `sabi/deepseek-v3`, `sabi/mistral-large`
- [ ] Auto-scaling, per-token billing
- [ ] Cheaper than Groq/Together (no middleman)

### Phase 13 — Smart Routing (v3.1.0)

- [ ] `model: "auto"` — Weysabi selects best model based on task complexity
- [ ] Cost optimization: simple → cheap hosted, complex → GPT-4/Claude
- [ ] Latency optimization: fastest available provider
- [ ] One bill from Weysabi

## Competitive Positioning

### vs Cencori

Cencori routes through their gateway and charges per token. Weysabi is an orchestration library — you bring your own keys, Weysabi runs in your process. No data passes through Weysabi's infrastructure (unless you use cloud sync). For fintech, healthcare, or regulated workloads, Weysabi's BYOK architecture is a structural moat.

### vs LangChain / Vercel AI SDK

| Feature           | LangChain     | Vercel AI SDK    | Weysabi            |
| ----------------- | ------------- | ---------------- | ------------------ |
| Provider failover | Manual        | Manual           | Auto               |
| Circuit breaker   | No            | No               | Built-in           |
| Structured output | Parser chains | `generateObject` | Zod-native         |
| Streaming         | Manual        | `streamText`     | Auto + adapters    |
| Tool calling      | Complex       | Good             | TS functions       |
| RAG               | Multiple deps | No               | Built-in           |
| Memory            | BufferMemory  | `useChat`        | Persisted sessions |
| Guardrails        | No            | No               | Built-in           |
| Prompt management | No            | No               | Typed + runnable   |
| Eval suites       | Third-party   | No               | Native + cloud     |
| Prompt versioning | No            | No               | Cloud dashboard    |
| Cost tracking     | No            | No               | Auto-logged        |
| Hosted models     | No            | No               | Phase 12           |
| Cloud dashboard   | No            | No               | Phase 11           |
| Setup time        | Days          | Hours            | Minutes            |

## Package Structure

```
@weysabi/sabi/
├── src/
│   ├── index.ts                 # WeysabiImpl class + createWeysabi() factory
│   ├── index.test.ts            # Core tests
│   ├── types.ts                 # Zod schemas + TS types
│   ├── errors.ts                # Error classes (7 total)
│   ├── utils.ts                 # parseModel, tryParseJSON
│   ├── providers.ts             # ProviderClient (handler dispatch, retry, circuit breaker)
│   ├── providers/
│   │   ├── handler.ts           # ProviderHandler interface
│   │   ├── openai.ts            # OpenAI-compatible (Groq, Nvidia, DeepSeek, etc.)
│   │   ├── anthropic.ts         # Anthropic Messages API handler
│   │   └── google.ts            # Google Gemini handler
│   ├── prompts/
│   │   ├── index.ts             # WeysabiPrompts + createWeysabiPrompts()
│   │   ├── prompt.ts            # PromptDefinition, Prompt class + render()
│   │   └── registry.ts          # PromptRegistry (structured prompt storage)
│   ├── sse.ts                   # Generic toResponse() for Web Fetch frameworks
│   ├── stream.ts                # Client-side readStream helper
│   ├── hono.ts                  # Re-exports SSE
│   ├── next.ts                  # Re-exports SSE
│   ├── elysia.ts                # Re-exports SSE
│   ├── express.ts               # pipe(stream, res)
│   ├── fastify.ts               # pipe(stream, reply)
│   ├── logger.ts                # Structured logger
│   ├── cache.ts                 # InMemoryCache + RedisCache
│   ├── cache.test.ts            # Cache tests
│   ├── otel.ts                  # OpenTelemetry plugin
│   ├── otel.test.ts             # OTEL plugin tests
│   ├── plugin.test.ts           # Plugin system tests
│   ├── cli/
│   │   ├── index.ts             # CLI entry point (commander)
│   │   ├── utils.ts             # Config load/save, provider test, table print
│   │   └── commands/
│   │       ├── init.ts          # sabi init
│   │       ├── config.ts        # sabi config validate
│   │       ├── complete.ts      # sabi complete
│   │       ├── stream.ts        # sabi stream
│   │       ├── prompt.ts        # sabi prompt {list,add,rm}
│   │       ├── benchmark.ts     # sabi benchmark
│   │       └── doctor.ts        # sabi doctor
│   ├── ai-sdk.ts                # Vercel AI SDK adapter (LanguageModelV3)
│   ├── ai-sdk.test.ts           # AI SDK adapter tests
│   ├── providers.test.ts        # Provider-specific tests
│   ├── stream.test.ts           # Streaming tests
│   ├── structured.test.ts       # Structured output tests
│   └── rag/
│       ├── index.ts             # Barrel exports
│       ├── engine.ts            # RagEngine — ingestion + query orchestration
│       ├── manager.ts           # RagManager — multi-project lifecycle
│       ├── store.ts             # RagStore — SQLite + HNSW persistence
│       ├── vector-index.ts      # HnswVectorIndex — ANN search
│       ├── chunker.ts           # splitText — recursive text splitting
│       ├── embedder.ts          # embedText / embedBatch — API calls
│       ├── loader.ts            # File discovery (text, markdown, code)
│       ├── object-store.ts      # FsObjectStore / SqliteObjectStore
│       └── types.ts             # RagOptions, RagChunk, etc.
│   └── chat/
│       ├── index.ts             # Barrel exports
│       ├── memory.ts            # ConversationMemory — session + context manager
│       ├── store.ts             # SqliteSessionStore — SQLite persistence
│       ├── pg-store.ts          # PgSessionStore — Postgres persistence
│       ├── memory.test.ts       # Chat tests
│       └── types.ts             # StoreInterface, MemoryOptions, PrepareResult, etc.
├── package.json
├── tsconfig.json
├── bunfig.toml
├── .eslintrc.cjs
├── .prettierrc
├── .prettierignore
└── .gitignore
```

Single package. Sub-path exports for adapters. Cloud features runtime-gated by API key.

## Key Decisions

- **Name**: Weysabi (Nigerian Pidgin — "wey sabi" = "the one who knows")
- **Org**: `github.com/weysabi` — separate from joinremba
- **One package**: `@weysabi/sabi`. Adapters loaded via sub-path exports (zero cost if unused)
- **BYOK**: No token markup. Revenue from cloud features
- **Open-core**: Library always free. Cloud gated by API key
- **Tests next to source**: `src/*.test.ts` pattern (same as catalog, beacon, gate)

## Pricing

### Cloud Features

| Tier       | Monthly Usage | Price  | Features                                 |
| ---------- | ------------- | ------ | ---------------------------------------- |
| Free       | 100K tokens   | $0     | Local mode, core library, basic prompts  |
| Hobby      | 1M tokens     | $19    | Cloud sync, structured output, streaming |
| Pro        | 10M tokens    | $79    | RAG, evals, guardrails, 30d history      |
| Team       | 100M tokens   | $299   | A/B testing, team features, SSO          |
| Enterprise | Custom        | Custom | On-prem, SLA, dedicated infra            |

### Hosted Inference

| Model           | Price per 1M tokens | vs OpenAI           | vs Groq     |
| --------------- | ------------------- | ------------------- | ----------- |
| Llama 4 Scout   | $0.10               | 97% cheaper         | 50% cheaper |
| DeepSeek V3     | $0.25               | 95% cheaper         | —           |
| Mistral Large   | $0.50               | 90% cheaper         | —           |
| GPT-4o (routed) | $10.00              | Same (pass-through) | —           |
