# Sabi

**AI orchestration for fullstack devs.** Use your own API keys. Provider failover, structured output, streaming, circuit breaker. One dependency, zero token markup.

```ts
import { createSabi } from "@weysabi/sabi";

const sabi = createSabi({
  openai: { apiKey: process.env.OPENAI_API_KEY },
  groq: { apiKey: process.env.GROQ_API_KEY },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
});

const result = await sabi.complete({
  model: "groq/llama-4-scout",
  prompt: "refund",
  inputs: { reason: "Item damaged", amount: "5000" },
  fallbacks: ["openai/gpt-4o-mini"],
});
```

## Why Sabi?

- **Your keys, your providers.** No markup, no gateway, no middleman.
- **One dependency.** Not LangChain + provider SDKs. Just `@weysabi/sabi`.
- **Zero config for common cases.** Structured output? Pass a Zod schema.
- **Works offline-first.** Cloud features (versioning, evals, monitoring) optional.
- **No lock-in.** Stop paying, the library still works.

## Features

| Feature                                                                | Status |
| ---------------------------------------------------------------------- | ------ |
| Provider abstraction (OpenAI, Groq, Nvidia, DeepSeek, OpenRouter)      | ✅     |
| Anthropic + Google Gemini providers                                    | ✅     |
| Prompt templates with `{variable}`                                     | ✅     |
| Circuit breaker + retry + backoff                                      | ✅     |
| Provider failover (primary → fallbacks)                                | ✅     |
| Streaming (SSE, async iterable)                                        | ✅     |
| Client-side `readStream` helper                                        | ✅     |
| Structured output (Zod schemas)                                        | ✅     |
| Framework adapters (Hono, Next, Express, Fastify, Elysia, generic SSE) | ✅     |
| Tool calling (auto-execute + chaining)                                 | ✅     |
| Telemetry hooks (latency, cost, errors, fallback)                      | ✅     |
| Cost estimation (per-response `estimatedCostUsd`)                      | ✅     |
| Plugin system (`sabi.use()` lifecycle hooks)                           | ✅     |
| Cache adapter (`InMemoryCache`, `RedisCache`, BYO)                     | ✅     |
| OpenTelemetry integration (`sabi/otel`)                                | ✅     |
| Vercel AI SDK adapter (`sabi/ai-sdk`)                                  | ✅     |
| Mistral + Ollama providers                                             | ✅     |
| CLI (`sabi init`, `complete`, `stream`, `config`, `prompt`, etc.)      | ✅     |
| RAG (zero-config, local or cloud)                                      | 🔜     |
| Memory & conversations                                                 | 🔜     |
| Guardrails (PII, content filter)                                       | 🔜     |
| Eval suites                                                            | 🔜     |
| Cloud dashboard                                                        | 🔜     |
| Hosted open-source models                                              | 🔜     |

## Quick Start

```bash
bun add @weysabi/sabi
```

```ts
import { createSabi } from "@weysabi/sabi";

const sabi = createSabi({
  groq: { apiKey: process.env.GROQ_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },
});

// Prompt templates
sabi.prompt("translate", "Translate {text} to {language}");

// Type-safe completions with auto-failover
const result = await sabi.complete({
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
const sabi = createSabi({
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
sabi.complete({ model: "anthropic/claude-3-5-sonnet-20241022", ... })
sabi.complete({ model: "google/gemini-2.0-flash", ... })
sabi.complete({ model: "groq/llama-4-scout", ... })
sabi.complete({ model: "openai/gpt-4o", ... })
```

## Structured Output

Pass a Zod schema — Sabi validates the response and retries on parse failure.

```ts
import { z } from "zod";

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});

const result = await sabi.complete({
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
for await (const chunk of sabi.stream({
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
import { readStream } from "@weysabi/sabi";

const response = await fetch("/api/chat", { ... });
for await (const chunk of readStream(response.body!)) {
  console.log(chunk.content);
}
```

## Framework Adapters

```ts
// Hono, Next.js, Elysia — any Web Fetch framework
import { toResponse } from "@weysabi/sabi/hono";
// import { toResponse } from "@weysabi/sabi/next";
// import { toResponse } from "@weysabi/sabi/elysia";
// import { toResponse } from "@weysabi/sabi/sse"; // generic

app.post("/chat", async (c) => {
  const stream = sabi.stream({ ... });
  return toResponse(stream);
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

## CLI

```bash
# Quick start
bun sabi init                          # Interactive setup
bun sabi config validate               # Test all provider keys
bun sabi complete "Hello" -m groq/llama-4-scout
bun sabi stream "Tell me a story" -m openai/gpt-4o-mini
bun sabi prompt list|add|rm            # Manage prompt templates
bun sabi benchmark                     # Latency comparison (3 runs/provider)
bun sabi doctor                        # System diagnostics
```

Config is read from `sabi.json`, `~/.config/sabi/config.json`, or `SABI_*_API_KEY` env vars.

## Plugin System

```ts
const sabi = createSabi({ groq: { apiKey } });

sabi.use({
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
import { InMemoryCache, RedisCache } from "@weysabi/sabi/cache";
// or: import { cacheKey } from "@weysabi/sabi";

// In-memory
const sabi = createSabi(providers, { cache: new InMemoryCache(60_000) });

// Redis (any Redis-like client)
const sabi = createSabi(providers, {
  cache: new RedisCache(new Redis(), 60_000),
});

// BYO — implement { get(key), set(key, value, ttlMs?) }
```

## OpenTelemetry

```ts
import { createOtelPlugin } from "@weysabi/sabi/otel";
import { trace } from "@opentelemetry/api";

const sabi = createSabi(providers);
sabi.use(createOtelPlugin({ tracer: trace.getTracer("my-app") }));
```

## Vercel AI SDK Adapter

```ts
import { createSabiProvider } from "@weysabi/sabi/ai-sdk";

const provider = createSabiProvider(sabi);
const result = await generateText({
  model: provider.languageModel("groq/llama-4-scout"),
  prompt: "Hello",
});
```

## Sub-path Exports

```ts
import { createSabi } from "@weysabi/sabi";
import { SabiError, SchemaValidationError } from "@weysabi/sabi/errors";
import { toResponse } from "@weysabi/sabi/sse";
import { pipe } from "@weysabi/sabi/express";
import { InMemoryCache, RedisCache } from "@weysabi/sabi/cache";
import { createOtelPlugin } from "@weysabi/sabi/otel";
import { createSabiProvider } from "@weysabi/sabi/ai-sdk";
```

## Philosophy

- **One dependency** competing with LangChain, not Vercel AI SDK.
- **Bring your own keys** — no token markup. Revenue from cloud features.
- **Future: hosted inference** — Sabi hosts Llama/Mistral/DeepSeek. Smart routing sends simple tasks to cheap hosted models, complex ones to GPT-4/Claude.

## License

MIT
