# @weysabi/sabi

**AI orchestration for fullstack devs.** Provider failover, structured output, streaming, RAG, guardrails, and prompt management — one dependency, zero markup.

```ts
import { createWeysabi } from "@weysabi/sabi";
import { z } from "zod";

const sabi = createWeysabi({
  groq: { apiKey: process.env.GROQ_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },
});

const res = await sabi.complete({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "Extract the invoice total." }],
  fallbacks: ["openai/gpt-4o-mini"],
  response: { schema: z.object({ total: z.number() }) },
  rag: ["invoices/*.pdf"],
  guardrails: ["pii"],
});

console.log(res.parsed.total, res.latencyMs);
```

## Why Weysabi?

- **Your keys, your providers.** No gateway, no token markup, no middleman.
- **One dependency.** Not LangChain + provider SDKs + vector DB. Just `@weysabi/sabi`.
- **Built-in everything.** Structured output, RAG, guardrails, prompts, streaming, caching — all ship in the box.
- **Works offline-first.** SQLite for conversations and RAG. No cloud dependency.
- **No lock-in.** Stop paying, the library still works. Your data stays with you.

## Features

| Feature | Status |
|---|---|
| Provider abstraction (OpenAI, Groq, Anthropic, Google, Mistral, DeepSeek, OpenRouter, Together, Nvidia, Ollama) | ✅ |
| Custom / OpenAI-compatible endpoints | ✅ |
| Provider failover (primary → fallbacks) | ✅ |
| Circuit breaker + retry + backoff | ✅ |
| Streaming (SSE, async iterable) | ✅ |
| Structured output (Zod schemas with auto-retry) | ✅ |
| Tool calling (auto-execute + chaining) | ✅ |
| Prompt templates with `{variable}` substitution | ✅ |
| Prompt registry (register, render, run) | ✅ |
| RAG engine (ingest, embed, HNSW search, persist) | ✅ |
| Multi-project RAG manager | ✅ |
| Guardrails (PII redaction, injection detection, content safety, token limits) | ✅ |
| Conversation memory (SQLite/Postgres, auto-truncation) | ✅ |
| ChatSDK (prepare + call + record in one) | ✅ |
| Framework adapters (Hono, Next.js, Express, Fastify, Elysia) | ✅ |
| Caching (InMemory, Redis, BYO) | ✅ |
| Plugin system (lifecycle hooks) | ✅ |
| OpenTelemetry integration | ✅ |
| Vercel AI SDK adapter | ✅ |
| Cost estimation (per-response `estimatedCostUsd`) | ✅ |
| CLI (`sabi init`, `complete`, `stream`, `config`, `prompt`) | ✅ |
| Control plane — projects, conversations, runs, API keys | 🔜 |
| Weysabi Cloud — hosted control plane, evals, monitoring | 🔜 |

## Install

```bash
bun add @weysabi/sabi
```

Requires Bun ≥ 1.3.

## Providers

Configure any provider with an API key. All providers share the same interface.

```ts
const sabi = createWeysabi({
  openai: { apiKey: process.env.OPENAI_API_KEY },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  google: { apiKey: process.env.GOOGLE_API_KEY },
  groq: { apiKey: process.env.GROQ_API_KEY },
  deepseek: { apiKey: process.env.DEEPSEEK_API_KEY },
  mistral: { apiKey: process.env.MISTRAL_API_KEY },
  nvidia: { apiKey: process.env.NVIDIA_API_KEY },
  openrouter: { apiKey: process.env.OPENROUTER_API_KEY },
  together: { apiKey: process.env.TOGETHER_API_KEY },
  ollama: { baseUrl: "http://localhost:11434" },
  // Custom OpenAI-compatible endpoint
  myproxy: { apiKey: "sk-...", baseUrl: "https://my-proxy.com/v1" },
});
```

Reference models with `provider/model-id` notation:

```ts
sabi.complete({ model: "groq/llama-4-scout", ... });
sabi.complete({ model: "openai/gpt-4o", ... });
sabi.complete({ model: "anthropic/claude-3-5-sonnet-20241022", ... });
```

## Provider Failover

Automatic fallback when a provider fails. Circuit breaker prevents hammering a failing endpoint.

```ts
const res = await sabi.complete({
  model: "groq/llama-4-scout",
  fallbacks: ["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku-20241022"],
  messages: [{ role: "user", content: "Hello" }],
});
// Groq fails → OpenAI fallback → response delivered
```

## Structured Output

Pass a Zod schema. Weysabi validates the response and retries on parse failure.

```ts
import { z } from "zod";

const CalendarSchema = z.object({
  events: z.array(z.object({
    title: z.string(),
    date: z.string(),
    attendees: z.array(z.string()),
  })),
});

const res = await sabi.complete({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "Schedule a meeting for next Tuesday." }],
  schema: CalendarSchema,
});

console.log(res.parsed.events);
// Typed as { title: string; date: string; attendees: string[] }[]
```

On parse failure, throws `SchemaValidationError` with `.raw` (raw response) and `.issues` (Zod errors).

## Streaming

Works with all providers and includes failover — if the primary provider fails mid-stream, the library transparently retries the full request against fallbacks.

```ts
const stream = sabi.stream({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "Write a poem." }],
});

for await (const chunk of stream) {
  if (chunk.content) process.stdout.write(chunk.content);
  if (chunk.usage) console.log("\nTokens:", chunk.usage.totalTokens);
}
```

### Framework Adapters

```ts
// Hono, Next.js, Elysia — any Web Fetch framework
import { toResponse } from "@weysabi/sabi/hono";
// import { toResponse } from "@weysabi/sabi/next";
// import { toResponse } from "@weysabi/sabi/elysia";

app.post("/chat", async (c) => {
  const stream = sabi.stream({ ... });
  return toResponse(stream); // SSE response
});

// Express
import { pipe } from "@weysabi/sabi/express";
app.post("/chat", async (req, res) => {
  const stream = sabi.stream({ ... });
  await pipe(stream, res);
});

// Fastify
import { pipe } from "@weysabi/sabi/fastify";
app.post("/chat", async (req, reply) => {
  const stream = sabi.stream({ ... });
  await pipe(stream, reply);
});
```

## Prompt Templates

Define, register, and run templates with `{variable}` substitution.

```ts
sabi.prompts.register({
  id: "classify",
  model: "groq/llama-4-scout",
  messages: [
    {
      role: "system",
      content: "You are a support ticket classifier.",
    },
    {
      role: "user",
      content: `Classify this ticket: {ticket_text}

Categories: billing, technical, account, feature_request

Respond with just the category.`,
    },
  ],
});

// Render + complete in one call
const result = await sabi.prompts.run("classify", {
  ticket_text: "I was overcharged for my subscription",
});

// Or render separately for inspection
const messages = sabi.prompts.render("classify", {
  ticket_text: "Login is broken",
});
```

## RAG (Retrieval-Augmented Generation)

Built-in vector search without an external vector database. Ingest documents, auto-chunk, embed, and search.

```ts
import { RagEngine } from "@weysabi/sabi/rag";

const rag = new RagEngine({
  dbPath: ".sabi/knowledge.db",
  embeddingModel: "openai/text-embedding-3-small",
});

rag.setProviders(
  { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  { openai: { apiKey: process.env.OPENAI_API_KEY } }
);

// Ingest files
await rag.load("docs/manual.pdf", "docs/faq.md");

// Query
const results = await rag.query("How do I reset my password?");
console.log(results[0].content);
```

Multi-project management:

```ts
import { RagManager } from "@weysabi/sabi/rag";

const manager = new RagManager({
  basePath: ".sabi/rag",
  providers: { embeddingProvider: { provider: "openai", apiKey: "..." } },
});

const docs = manager.project("docs-v2");
await docs.load("guides/");

const hits = await docs.query("pricing");
```

## Guardrails

PII redaction, prompt injection detection, content moderation, and output token limits.

```ts
const res = await sabi.complete({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "My email is test@example.com" }],
  guardrails: ["pii"],                     // Redact emails, phones, SSNs
  // guardrails: ["injection"],            // Detect prompt injection
  // guardrails: ["content"],             // Moderate toxic content
  // guardrails: [{ type: "limits", maxOutputTokens: 100 }],
});
```

Guardrails can also be used standalone:

```ts
import { guardrail } from "@weysabi/sabi/guardrails";

const result = await guardrail("pii", "My SSN is 123-45-6789");
console.log(result.redacted); // "My SSN is [REDACTED]"
```

## Conversation Memory

Persistent chat history with automatic context management. SQLite by default, Postgres for production.

```ts
import { ConversationMemory } from "@weysabi/sabi/chat";

const memory = new ConversationMemory({
  dbPath: ".sabi/chat.db",
  maxHistoryTokens: 16384,
});

// Prepare context — no API call
const ctx = memory.prepare("user-abc", {
  message: "Hi, my name is Bob",
  system: "You are a helpful assistant",
});

// Call your provider SDK natively
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  system: ctx.system,
  messages: ctx.messages,
});

// Record the turn
memory.record("user-abc", {
  userMessage: { content: "Hi, my name is Bob" },
  assistantMessage: { content: response.content[0].text },
});

// Next turn — history is loaded automatically
const ctx2 = memory.prepare("user-abc", {
  message: "What's my name?",
});
// ctx2.messages includes full history
```

Postgres for production:

```ts
import postgres from "postgres";
import { ConversationMemory, PgSessionStore } from "@weysabi/sabi/chat";

const sql = postgres("postgres://user:pass@host:5432/db");
const memory = new ConversationMemory({
  store: new PgSessionStore(sql),
});
```

## Tool Calling

Define tools with Zod schemas. The library handles execution and chaining.

```ts
const res = await sabi.complete({
  model: "groq/llama-4-scout",
  messages: [{ role: "user", content: "What's the weather in London?" }],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather",
      schema: z.object({ city: z.string() }),
      execute: async ({ city }) => fetchWeather(city),
    },
  ],
});
```

## Caching

```ts
import { InMemoryCache, RedisCache } from "@weysabi/sabi/cache";

const sabi = createWeysabi(providers, {
  cache: new InMemoryCache(60_000), // 60s TTL
});
```

## Plugins

Lifecycle hooks for telemetry, logging, or custom behavior.

```ts
sabi.use({
  name: "logger",
  onCompleteRequest(req) {
    console.log("Request:", req.model);
    return req;
  },
  onCompleteResponse(res, req) {
    console.log("Response:", res.latencyMs, "ms");
    return res;
  },
  onError(err, { request }) {
    console.error("Failed:", err.message);
  },
});
```

## OpenTelemetry

```ts
import { createOtelPlugin } from "@weysabi/sabi/otel";

sabi.use(createOtelPlugin({ tracer: trace.getTracer("my-app") }));
```

## Vercel AI SDK

```ts
import { createWeysabiProvider } from "@weysabi/sabi/ai-sdk";

const provider = createWeysabiProvider(sabi);
const result = await generateText({
  model: provider.languageModel("groq/llama-4-scout"),
  prompt: "Hello",
});
```

## CLI

```bash
# Interactive project setup
bun sabi init

# Test provider connectivity
bun sabi config validate

# Quick completions
bun sabi complete "Hello" -m groq/llama-4-scout
bun sabi stream "Tell me a story" -m openai/gpt-4o-mini

# Manage prompts
bun sabi prompt list
bun sabi prompt add classify -f prompts/classify.txt
```

## HTTP Server

Deploy as an OpenAI-compatible API with auth, rate limits, quotas, usage tracking, and admin monitoring.

```bash
bun sabi server --port 3000
```

Or embed in your app:

```ts
import { createServer } from "@weysabi/server";

const server = await createServer(sabi, {
  apiKey: "sk-my-key",
  adminApiKey: "sk-admin-secret",
});
```

See [@weysabi/server](https://github.com/weysabi/sabi/tree/dev/packages/server) for full documentation.

## Sub-path Exports

```ts
import { createWeysabi } from "@weysabi/sabi";
import { WeysabiError } from "@weysabi/sabi/errors";
import { toResponse } from "@weysabi/sabi/sse";
import { pipe } from "@weysabi/sabi/express";
import { InMemoryCache } from "@weysabi/sabi/cache";
import { createOtelPlugin } from "@weysabi/sabi/otel";
import { createWeysabiProvider } from "@weysabi/sabi/ai-sdk";
import { RagEngine, RagManager } from "@weysabi/sabi/rag";
import { ConversationMemory } from "@weysabi/sabi/chat";
import { PromptRegistry } from "@weysabi/sabi/prompts";
```

## License

MIT
