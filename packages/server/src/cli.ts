#!/usr/bin/env bun
import { parseApiKeys } from "./middleware";
import { createModuleLogger } from "./logger";
import {
  resolveProvidersFromEnv,
  requireProviders,
  registerShutdownHandlers,
  providerNames,
} from "./bootstrap";

const log = createModuleLogger("cli");

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port") !== -1 ? args.indexOf("--port") : args.indexOf("-p");
const port = portIdx !== -1 ? Number(args[portIdx + 1]) : undefined;
const hostIdx = args.indexOf("--host");
const host = hostIdx !== -1 ? args[hostIdx + 1] : undefined;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
weysabi-server — OpenAI-compatible AI backend

USAGE
  bunx weysabi-server [options]

OPTIONS
  -p, --port <port>  Port to listen on (default: 3000, or $WEYSABI_PORT)
      --host <host>  Host to bind to (default: 0.0.0.0)
      --help         Show this help

ENVIRONMENT
  WEYSABI_OPENAI_API_KEY       OpenAI API key
  WEYSABI_GROQ_API_KEY         Groq API key
  WEYSABI_ANTHROPIC_API_KEY    Anthropic API key
  WEYSABI_GOOGLE_API_KEY       Google AI API key
  WEYSABI_MISTRAL_API_KEY      Mistral AI API key
  WEYSABI_DEEPSEEK_API_KEY     DeepSeek API key
  WEYSABI_TOGETHER_API_KEY     Together AI API key
  WEYSABI_NVIDIA_API_KEY       NVIDIA API key
  WEYSABI_OPENROUTER_API_KEY   OpenRouter API key
  WEYSABI_OLLAMA_API_KEY       Ollama API key
  WEYSABI_API_KEY              Admin API key (all scopes)
  WEYSABI_ADMIN_API_KEY        Dedicated key for /v1/admin endpoints
  WEYSABI_API_KEYS             Scoped keys: key:scope1,scope2;key2
  WEYSABI_PORT                 Port (default: 3000)
  WEYSABI_HOST                 Host (default: 0.0.0.0)
  WEYSABI_CORS_ORIGINS         CORS origins, comma-separated (default: *)
  WEYSABI_RATE_LIMIT_RPM       Rate limit per minute (default: 300)
  WEYSABI_IDEMPOTENCY_TTL      Idempotency key TTL in seconds (default: 86400)
  WEYSABI_STORAGE              Storage backend: sqlite (default) or postgres
  WEYSABI_DATABASE_URL         Postgres connection string (required for postgres storage)
  WEYSABI_REDIS_URL            Redis connection string (optional)
  WEYSABI_AUTH_URL             Public URL for auth callbacks (default: http://localhost:<port>)
  WEYSABI_AUTH_SECRET          Auth session secret (default: auto-generated)
`);
  process.exit(0);
}

const providers = resolveProvidersFromEnv();
requireProviders(providers);

const { createWeysabi } = await import("weysabi");
const weysabi = createWeysabi(providers);

const { createServer } = await import("./index");
const storage = (process.env.WEYSABI_STORAGE ?? "sqlite") as "sqlite" | "postgres";
const server = await createServer(weysabi, {
  port: port ?? (process.env.WEYSABI_PORT ? Number(process.env.WEYSABI_PORT) : undefined),
  hostname: host ?? process.env.WEYSABI_HOST,
  apiKey: process.env.WEYSABI_API_KEY || undefined,
  adminApiKey: process.env.WEYSABI_ADMIN_API_KEY || undefined,
  apiKeys: process.env.WEYSABI_API_KEYS ? parseApiKeys(process.env.WEYSABI_API_KEYS) : undefined,
  providers: providerNames(providers),
  storage,
  databaseUrl: process.env.WEYSABI_DATABASE_URL || undefined,
  redisUrl: process.env.WEYSABI_REDIS_URL || undefined,
  controlPlane: true,
});

const displayHost =
  server.hostname === "0.0.0.0" || server.hostname === "::" ? "localhost" : server.hostname;

log.info("Weysabi Server ready", {
  url: `http://${displayHost}:${server.port}`,
  providers: providerNames(providers),
  auth: !!process.env.WEYSABI_API_KEY || !!process.env.WEYSABI_API_KEYS,
});

registerShutdownHandlers(() => server.stop());
