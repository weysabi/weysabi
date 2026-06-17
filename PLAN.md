# Sabi — Product Plan

**Repository**: `github.com/weysabi/sabi`
**Package**: `@weysabi/sabi`
**Domain**: `weysabi.ai`

## Vision

Sabi makes building AI products boring. One library. Your own API keys. Provider failover, prompt management, structured output, RAG, streaming, evals, cost tracking, and observability — all in one place.

For fullstack devs who don't have an ML team. You know your stack (TypeScript, React, Postgres). Sabi adds AI to it.

## Core Philosophy

- **Single dependency.** Not LangChain + Pinecone + provider SDKs + eval framework. Just `@weysabi/sabi`.
- **Your keys, your providers.** Sabi never marks up tokens. You pay OpenAI/Groq/Anthropic directly. Sabi charges for orchestration — versioning, evals, monitoring, team sync.
- **Zero config for common cases.** RAG? Point at a PDF. Structured output? Pass a Zod schema.
- **Works offline-first.** No cloud required. Cloud adds versioning, evals, monitoring, team.
- **TypeScript everything.** Autocomplete, type safety, no runtime surprises.
- **No lock-in.** Stop paying, the library still works.

## Business Model

### Phase 1 — Orchestration Only (Now)

Users bring their own API keys. Sabi routes, fails over, retries, manages prompts. Revenue from cloud features.

```
sabi.complete({ model: "groq/llama-4-scout", ... })
  → sends directly to Groq's API
  → Sabi never sees the request body
  → you pay Groq, not Sabi
```

### Phase 2 — Hosted Inference (Future)

Sabi hosts open-source models (Llama, Mistral, DeepSeek). Users use `sabi/llama-4-scout` — Sabi runs inference, charges per token. Cheaper than Groq/Together (no middleman).

### Phase 3 — Smart Routing (Future)

Sabi routes simple tasks to cheap hosted models, complex tasks to GPT-4/Claude. One bill.

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
- [ ] Mistral AI provider (dedicated handler)
- [ ] Ollama provider (local models, zero config)

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
- [ ] OpenTelemetry integration pattern
- [ ] Pluggable cache adapter (in-memory default, BYO Redis)

### Phase 5 — Distribution (v0.8.0)

- [ ] Vercel AI SDK adapter (`sabi/ai-sdk`) — `LanguageModelV1`-compatible
- [ ] Get listed on `ai-sdk.dev/providers/community-providers`
- [ ] CLI: `bunx sabi test` — verify provider keys, benchmark latency
- [ ] Middleware/plugin system — `sabi.use(hook)` for extensions

### Phase 6 — RAG & Memory (v1.0.0)

- [ ] `sabi.rag.load(source)` — ingest URLs, PDFs, markdown
- [ ] `sabi.rag.query()` — auto-retrieve relevant context
- [ ] Local vector store (SQLite + HNSW, zero deps)
- [ ] Embedding support — `sabi.embed()` with failover
- [ ] `sabi.chat({ sessionId })` — persistent conversation history
- [ ] Automatic summarization for long conversations

### Phase 7 — Guardrails (v1.1.0)

- [ ] PII redaction (emails, phones, SSNs, credit cards)
- [ ] Topic blocking
- [ ] Output token limits
- [ ] Custom guardrails — `sabi.guardrail("name", { validate, onViolation })`

### Phase 8 — Eval Suites (v1.2.0)

- [ ] `sabi.eval.createSuite("name")` — create test suites
- [ ] `suite.addCase({ prompt, inputs, expected })` — add test cases
- [ ] `suite.run({ model })` — run all cases, get pass/fail
- [ ] CI gate: `sabi eval check --min-pass=90`

### Phase 9 — Cloud Dashboard (v2.0.0)

- [ ] Prompt management (CRUD, versioning, diff, rollback)
- [ ] Usage analytics (requests, tokens, cost by model/user/time)
- [ ] Eval suite dashboard (history, regression alerts)
- [ ] RAG document management
- [ ] Full trace logs (prompt, response, latency, cost)
- [ ] Team features (shared prompts, API keys, roles, audit log)
- [ ] Auth (JWT-based, admin users, sessions)

### Phase 10 — Hosted Inference (v3.0.0)

- [ ] GPU infra for open-source models
- [ ] `sabi/llama-4-scout`, `sabi/deepseek-v3`, `sabi/mistral-large`
- [ ] Auto-scaling, per-token billing
- [ ] Cheaper than Groq/Together (no middleman)

### Phase 11 — Smart Routing (v3.1.0)

- [ ] `model: "auto"` — Sabi selects best model based on task complexity
- [ ] Cost optimization: simple → cheap hosted, complex → GPT-4/Claude
- [ ] Latency optimization: fastest available provider
- [ ] One bill from Sabi

## Competitive Positioning

### vs Cencori

Cencori routes through their gateway and charges per token. Sabi is an orchestration library — you bring your own keys, Sabi runs in your process. No data passes through Sabi's infrastructure (unless you use cloud sync). For fintech, healthcare, or regulated workloads, Sabi's BYOK architecture is a structural moat.

### vs LangChain / Vercel AI SDK

| Feature           | LangChain     | Vercel AI SDK    | Sabi               |
| ----------------- | ------------- | ---------------- | ------------------ |
| Provider failover | Manual        | Manual           | Auto               |
| Circuit breaker   | No            | No               | Built-in           |
| Structured output | Parser chains | `generateObject` | Zod-native         |
| Streaming         | Manual        | `streamText`     | Auto + adapters    |
| Tool calling      | Complex       | Good             | TS functions       |
| RAG               | Multiple deps | No               | Built-in (Phase 6) |
| Memory            | BufferMemory  | `useChat`        | Persisted sessions |
| Guardrails        | No            | No               | Built-in (Phase 7) |
| Eval suites       | Third-party   | No               | Native + cloud     |
| Prompt versioning | No            | No               | Cloud dashboard    |
| Cost tracking     | No            | No               | Auto-logged        |
| Hosted models     | No            | No               | Phase 10           |
| Cloud dashboard   | No            | No               | Phase 9            |
| Setup time        | Days          | Hours            | Minutes            |

## Package Structure

```
@weysabi/sabi/
├── src/
│   ├── index.ts                 # SabiImpl class + createSabi() factory
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
│   ├── prompts.ts               # PromptRegistry (templates with {variable})
│   ├── sse.ts                   # Generic toResponse() for Web Fetch frameworks
│   ├── stream.ts                # Client-side readStream helper
│   ├── hono.ts                  # Re-exports SSE
│   ├── next.ts                  # Re-exports SSE
│   ├── elysia.ts                # Re-exports SSE
│   ├── express.ts               # pipe(stream, res)
│   ├── fastify.ts               # pipe(stream, reply)
│   ├── logger.ts                # Structured logger
│   ├── providers.test.ts        # Provider-specific tests
│   ├── stream.test.ts           # Streaming tests
│   └── structured.test.ts       # Structured output tests
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

- **Name**: Sabi (Nigerian Pidgin — "wey sabi" = "the one who knows")
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
