<p align="center">
  <strong>Weysabi</strong>
</p>

<p align="center">
  AI orchestration for fullstack devs — provider failover, structured output, streaming, RAG, guardrails, and prompt management. One dependency, zero token markup.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/weysabi"><img src="https://img.shields.io/npm/v/weysabi.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/weysabi.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.1-black?logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-6-blue" alt="TypeScript">
</p>

---

```ts
import { createWeysabi } from "weysabi";

const weysabi = createWeysabi({
  openai: { apiKey: process.env.OPENAI_API_KEY },
  groq: { apiKey: process.env.GROQ_API_KEY },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
});

const result = await weysabi.complete({
  model: "groq/llama-4-scout",
  prompt: "refund",
  inputs: { reason: "Item damaged", amount: "5000" },
  fallbacks: ["openai/gpt-4o-mini"],
});
```

## Why Weysabi?

- **Your keys, your providers.** No markup, no gateway, no middleman.
- **One dependency.** Not LangChain + provider SDKs. Just `weysabi`.
- **Zero config for common cases.** Structured output? Pass a Zod schema.
- **Works offline-first.** Cloud features (versioning, evals, monitoring) optional.
- **No lock-in.** Stop paying, the library still works.

## Features

| Feature                                                                      | Status |
| ---------------------------------------------------------------------------- | ------ |
| Provider abstraction (OpenAI, Groq, Nvidia, DeepSeek, OpenRouter)            | ✅     |
| Anthropic + Google Gemini providers                                          | ✅     |
| Prompt templates with `{variable}`                                           | ✅     |
| Circuit breaker + retry + backoff                                            | ✅     |
| Provider failover (primary → fallbacks)                                      | ✅     |
| Auto-routing (model array sugar — `["cheap", "gpt-4o"]`)                     | ✅     |
| Streaming (SSE, async iterable)                                              | ✅     |
| Client-side `readStream` helper                                              | ✅     |
| Structured output (Zod schemas)                                              | ✅     |
| Framework adapters (Hono, Next, Express, Fastify, Elysia, generic SSE)       | ✅     |
| Tool calling (auto-execute + chaining)                                       | ✅     |
| Telemetry hooks (latency, cost, errors, fallback)                            | ✅     |
| Cost estimation (per-response `estimatedCostUsd`)                            | ✅     |
| Plugin system (`weysabi.use()` lifecycle hooks)                                 | ✅     |
| Cache adapter (`InMemoryCache`, `RedisCache`, BYO)                           | ✅     |
| OpenTelemetry integration (`weysabi/otel`)                                      | ✅     |
| Vercel AI SDK adapter (`weysabi/ai-sdk`)                                        | ✅     |
| Mistral + Ollama providers                                                   | ✅     |
| CLI (`weysabi init`, `complete`, `stream`, `config`, `prompt`, etc.)            | ✅     |
| RAG (zero-config, local or cloud)                                            | ✅     |
| Memory & conversations (persistent sessions, auto-truncation)                | ✅     |
| ChatSDK (prepare + call + record in one)                                     | ✅     |
| Weysabi Server (deployable AI backend — `POST /v1/chat/completions`)         | ✅     |
| Guardrails (PII redaction, injection detection, ML moderation, token limits) | ✅     |

| Eval suites | 🔜 |
| Cloud dashboard | 🔜 |
| Hosted open-source models | 🔜 |

## Quick Start

```bash
# Scaffold a new project
bunx create-weysabi-app my-app

# Or add to an existing project
bun add weysabi
```

```ts
import { createWeysabi } from "weysabi";

const weysabi = createWeysabi({
  groq: { apiKey: process.env.GROQ_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },
});

// Prompt templates
weysabi.prompt("translate", "Translate {text} to {language}");

// Type-safe completions with auto-failover
const result = await weysabi.complete({
  model: "groq/llama-4-scout",
  prompt: "translate",
  inputs: { text: "Hello", language: "French" },
  fallbacks: ["openai/gpt-4o-mini"],
});

console.log(result.content); // "Bonjour"
```

## Providers

Configure any provider with just an API key. Custom `baseUrl` for self-hosted / OpenAI-compatible endpoints.

```ts
const weysabi = createWeysabi({
  openai: { apiKey: "sk-..." },
  anthropic: { apiKey: "sk-ant-..." },
  google: { apiKey: "AIza..." },
  groq: { apiKey: "gsk_..." },
  deepseek: { apiKey: "sk-..." },
  nvidia: { apiKey: "nvapi-..." },
  openrouter: { apiKey: "sk-..." },
  together: { apiKey: "..." },
  custom: { apiKey: "...", baseUrl: "https://my-endpoint.com/v1" },
});
```

Use `provider/model` notation:

```ts
weysabi.complete({ model: "anthropic/claude-3-5-sonnet-20241022", ... })
weysabi.complete({ model: "google/gemini-2.0-flash", ... })
weysabi.complete({ model: "groq/llama-4-scout", ... })
weysabi.complete({ model: "openai/gpt-4o", ... })
```

## Structured Output

Pass a Zod schema — Weysabi validates the response and retries on parse failure.

```ts
import { z } from "zod";

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});

const result = await weysabi.complete({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "Get user info" }],
  schema: UserSchema,
});

// result.parsed is typed as { name: string; age: number }
console.log(result.parsed.name, result.parsed.age);
```

On failure, throws `SchemaValidationError` with `.raw` (raw response) and `.issues` (structured errors).

## Streaming

```ts
for await (const chunk of weysabi.stream({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "Write a story" }],
  fallbacks: ["openai/gpt-4o-mini"],
})) {
  process.stdout.write(chunk.content);
  if (chunk.done) break;
}
```

### Client-side `readStream`

```ts
import { readStream } from "weysabi";

const response = await fetch("/api/chat", { ... });
for await (const chunk of readStream(response.body!)) {
  console.log(chunk.content);
}
```

## Framework Adapters

```ts
// Hono, Next.js, Elysia — any Web Fetch framework
import { toResponse } from "weysabi/hono";
// import { toResponse } from "weysabi/next";
// import { toResponse } from "weysabi/elysia";
// import { toResponse } from "weysabi/sse"; // generic

app.post("/chat", async (c) => {
  const stream = weysabi.stream({ ... });
  return toResponse(stream);
});

// Express
import { pipe } from "weysabi/express";
app.post("/chat", async (req, res) => {
  const stream = weysabi.stream({ ... });
  await pipe(stream, res);
});

// Fastify
import { pipe } from "weysabi/fastify";
app.post("/chat", async (req, reply) => {
  const stream = weysabi.stream({ ... });
  await pipe(stream, reply);
});
```

## CLI

```bash
# Scaffold a project
bunx create-weysabi-app my-app         # Quick scaffold

# Quick start
bun weysabi init                          # Interactive setup
bun weysabi config validate               # Test all provider keys
bun weysabi complete "Hello" -m groq/llama-4-scout
bun weysabi stream "Tell me a story" -m openai/gpt-4o-mini
bun weysabi prompt list|add|rm            # Manage prompt templates
bun weysabi benchmark                     # Latency comparison (3 runs/provider)
bun weysabi doctor                        # System diagnostics
```

Config is read from `weysabi.json`, `~/.config/weysabi/config.json`, or `WEYSABI_*_API_KEY` env vars.

## Plugin System

```ts
const weysabi = createWeysabi({ groq: { apiKey } });

weysabi.use({
  name: "logger",
  onCompleteRequest(req) {
    console.log("Sending:", req.model);
    return req;
  },
  onCompleteResponse(res, req) {
    console.log("Got response:", res.latencyMs, "ms");
    return res;
  },
  onError(err, { request }) {
    console.error("Failed:", err.message);
  },
});
```

## Caching

```ts
import { InMemoryCache, RedisCache } from "weysabi/cache";
// or: import { cacheKey } from "weysabi";

// In-memory
const weysabi = createWeysabi(providers, { cache: new InMemoryCache(60_000) });

// Redis (any Redis-like client)
const weysabi = createWeysabi(providers, {
  cache: new RedisCache(new Redis(), 60_000),
});

// BYO — implement { get(key), set(key, value, ttlMs?) }
```

## OpenTelemetry

```ts
import { createOtelPlugin } from "weysabi/otel";
import { trace } from "@opentelemetry/api";

const weysabi = createWeysabi(providers);
weysabi.use(createOtelPlugin({ tracer: trace.getTracer("my-app") }));
```

## Vercel AI SDK Adapter

```ts
import { createWeysabiProvider } from "weysabi/ai-sdk";

const provider = createWeysabiProvider(weysabi);
const result = await generateText({
  model: provider.languageModel("groq/llama-4-scout"),
  prompt: "Hello",
});
```

## Sub-path Exports

```ts
import { createWeysabi } from "weysabi";
import { WeysabiError, SchemaValidationError } from "weysabi/errors";
import { toResponse } from "weysabi/sse";
import { pipe } from "weysabi/express";
import { InMemoryCache, RedisCache } from "weysabi/cache";
import { createOtelPlugin } from "weysabi/otel";
import { createWeysabiProvider } from "weysabi/ai-sdk";
import { RagEngine, RagManager } from "weysabi/rag";
import { ConversationMemory } from "weysabi/chat";
import { createServer } from "weysabi-server";
```

## Server

Deploy Weysabi as an OpenAI-compatible HTTP server. Frontend devs point their OpenAI SDK at it and get provider failover, caching, rate limiting, and auth — no backend code.

```bash
# Quick start — uses WEYSABI_*_API_KEY env vars
bunx weysabi-server --port 3000

# Or via the weysabi CLI
bun weysabi server --port 3000
```

```ts
// Embed in your app
import { createServer } from "weysabi-server";

const server = await createServer(weysabi, {
  apiKey: "sk-my-key",
  providers: ["groq", "openai"],
});
```

**Endpoints:** `POST /v1/chat/completions` (OpenAI-compatible, streaming), `GET /v1/models`, `GET /health`, `POST /v1/rag/query`, `POST /v1/chat/session`.

Works with any OpenAI SDK client — `useChat()`, `new OpenAI()`, `curl`.

**Configuration:** Set `WEYSABI_*_API_KEY` env vars for providers. Optional: `WEYSABI_API_KEY` for auth, `WEYSABI_API_KEYS` for scoped keys (`key:chat:write;key2:admin`), `WEYSABI_PORT` (default `3000`), `WEYSABI_RATE_LIMIT_RPM` (default `300`).

## RAG (Retrieval-Augmented Generation)

Zero-dependency RAG built in. Ingest documents, auto-chunk, embed, and search — no external vector DB required.

```ts
import { RagEngine, RagManager } from "weysabi/rag";

// Single project
const rag = new RagEngine({
  dbPath: ".weysabi/my-docs.db",
  embeddingModel: "openai/text-embedding-3-small",
});

// Must configure an embedding provider
rag.setProviders(
  { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  { openai: { apiKey: process.env.OPENAI_API_KEY } }
);

// Ingest files
await rag.load("docs/manual.pdf", "docs/readme.md");

// Search
const results = await rag.query("How do I reset the device?");

// Multi-project manager
const manager = new RagManager({
  basePath: ".weysabi/rag/projects",
  providers: { embeddingProvider: { provider: "openai", apiKey: "..." } },
});
const docs = manager.project("docs-v2");
await docs.load("guides/");

// Scoped search
const hits = await docs.query("pricing", 5, { pathPrefix: "guides/api" });

// Streaming ingestion with progress
for await (const ev of docs.loadStream("large-directory/")) {
  if (ev.type === "file_done") console.log(`${ev.filePath}: ${ev.chunks} chunks`);
}
```

### Architecture

| Component                                 | File                      | What                                                    |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------- |
| `RagEngine`                               | `src/rag/engine.ts`       | Orchestrates ingestion, embedding, query                |
| `RagManager`                              | `src/rag/manager.ts`      | Multi-project lifecycle, cross-project search           |
| `RagStore`                                | `src/rag/store.ts`        | SQLite + HNSW persistence, WAL-mode at scale            |
| `HnswVectorIndex`                         | `src/rag/vector-index.ts` | In-memory approximate nearest neighbor (HNSW algorithm) |
| `splitText`                               | `src/rag/chunker.ts`      | Recursive text splitting with configurable overlap      |
| `embedText` / `embedBatch`                | `src/rag/embedder.ts`     | OpenAI-compatible embedding API calls                   |
| `FsObjectStore` / `SqliteObjectStore`     | `src/rag/object-store.ts` | Pluggable content storage (disk, SQLite, S3)            |
| `loadFile` / `loadDirectory` / `loadText` | `src/rag/loader.ts`       | File discovery (PDF, markdown, code, text)              |

## Chat & Memory

Provider-agnostic conversation memory with automatic context management. Persist sessions to SQLite, then call your provider SDK natively.

```ts
import { ConversationMemory } from "weysabi/chat";

const memory = new ConversationMemory({
  dbPath: ".weysabi/chat.db",
  maxHistoryTokens: 16384,
});

// Prepare context — no API call
const ctx = memory.prepare("user-abc", {
  message: "Hi, my name is Bob",
  system: "You are a helpful assistant",
});
// ctx.messages = [{ role: "user", content: "Hi, my name is Bob" }]
// ctx.system   = "You are a helpful assistant"
// ctx.historyTruncated = false

// Call provider SDK natively (e.g. Anthropic)
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  system: ctx.system,
  messages: ctx.messages,
});

// Save the turn after success
memory.record("user-abc", {
  userMessage: { content: "Hi, my name is Bob" },
  assistantMessage: { content: response.content[0].text },
});

// Second turn — history is automatically included
const ctx2 = memory.prepare("user-abc", {
  message: "What's my name?",
});
// ctx2.messages = [
//   { role: "user", content: "Hi, my name is Bob" },
//   { role: "assistant", content: "Nice to meet you, Bob!" },
//   { role: "user", content: "What's my name?" },
// ]

// Inspect session
const session = await memory.getSession("user-abc");
console.log(session?.messageCount); // total messages

// Browse sessions
const sessions = await memory.listSessions();

// Delete
await memory.deleteSession("user-abc");
```

| Feature            | Detail                                                       |
| ------------------ | ------------------------------------------------------------ |
| Persistence        | SQLite (default) or Postgres (BYO `postgres` client)         |
| Context window     | Auto-truncates old messages when `maxHistoryTokens` exceeded |
| Provider-agnostic  | Works with any SDK (OpenAI, Anthropic, Cohere, self-hosted)  |
| Session management | `getSession()`, `listSessions()`, `deleteSession()`          |
| Pluggable store    | Implement `StoreInterface` for any backend                   |
| Zero dependency    | Built-in SQLite via Bun                                      |

### ChatSDK (Higher-level convenience)

Wraps `ConversationMemory` with a provider adapter for prepare + call + record in one call.

```ts
import { ConversationMemory, ChatSDK, OpenAIAdapter } from "weysabi/chat";

const memory = new ConversationMemory({ dbPath: ".weysabi/chat.db" });

const chat = new ChatSDK({
  memory,
  adapter: new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }),
});

// Single call — prepare + API call + record
const res = await chat.chat("session-1", {
  message: "Hello",
  system: "You are helpful",
  model: "gpt-4o",
});
console.log(res.content);

// Streaming
for await (const chunk of chat.stream("session-1", {
  message: "Tell me a story",
  model: "gpt-4o",
})) {
  process.stdout.write(chunk.text);
}

// BYO adapter — implement ChatAdapter interface
import type { ChatAdapter } from "weysabi/chat";
class CustomAdapter implements ChatAdapter {
  async chat(model, messages, system) {
    /* ... */
  }
  async *stream(model, messages, system) {
    /* ... */
  }
}
```

| Feature       | Detail                                       |
| ------------- | -------------------------------------------- |
| `chat()`      | prepare + provider call + record in one call |
| `stream()`    | Same as `chat()` but streaming               |
| `ChatAdapter` | ~20 lines to support any API                 |
| Ships with    | `OpenAIAdapter`, `AnthropicAdapter` examples |

### Auto-routing (model fallback)

Pass an array — fails through to the next on error.

```ts
const res = await chat.chat("session-1", {
  message: "Hello",
  model: ["groq/llama-4-scout", "openai/gpt-4o"],
});
// tries groq first; on failure, falls back to gpt-4o
```

### Postgres Store

Swap SQLite for Postgres in production — same API, one import change.

```ts
import postgres from "postgres";
import { ConversationMemory, PgSessionStore } from "weysabi/chat";

const sql = postgres("postgres://user:pass@host:5432/db");
const memory = new ConversationMemory({
  store: new PgSessionStore(sql),
});
```

Or bring your own store:

```ts
import type { StoreInterface } from "weysabi/chat";

class RedisStore implements StoreInterface {
  // implement all methods — async, same interface
}
```

### Scale

- **WAL-mode SQLite** with 64MB cache, memory-mapped I/O, and 64KB pages
- **HNSW vector index** persists to `.hnsw.idx` + `.hnsw.vec` binary files for instant startup
- **Embedding batch size** configurable (default 512) to stay under API limits
- **Object store** can offload chunk content from SQLite to disk or S3
- **Brute-force fallback** when no vector index configured (for small corpuses)

## Philosophy

- **One dependency** competing with LangChain, not Vercel AI SDK.
- **Bring your own keys** — no token markup. Revenue from cloud features.
- **Future: hosted inference** — Weysabi hosts Llama/Mistral/DeepSeek. Smart routing sends simple tasks to cheap hosted models, complex ones to GPT-4/Claude.

## License

MIT
