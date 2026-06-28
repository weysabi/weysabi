#!/usr/bin/env bun
import { parseApiKeys } from "./middleware";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("cli");

const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "SABI_OPENAI_API_KEY",
  groq: "SABI_GROQ_API_KEY",
  anthropic: "SABI_ANTHROPIC_API_KEY",
  google: "SABI_GOOGLE_API_KEY",
  mistral: "SABI_MISTRAL_API_KEY",
  deepseek: "SABI_DEEPSEEK_API_KEY",
  together: "SABI_TOGETHER_API_KEY",
  nvidia: "SABI_NVIDIA_API_KEY",
  openrouter: "SABI_OPENROUTER_API_KEY",
  ollama: "SABI_OLLAMA_API_KEY",
};

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port") !== -1 ? args.indexOf("--port") : args.indexOf("-p");
const port = portIdx !== -1 ? Number(args[portIdx + 1]) : undefined;
const hostIdx = args.indexOf("--host");
const host = hostIdx !== -1 ? args[hostIdx + 1] : undefined;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
@weysabi/server — OpenAI-compatible AI backend

USAGE
  bunx @weysabi/server [options]

OPTIONS
  -p, --port <port>  Port to listen on (default: 3000, or $SABI_PORT)
      --host <host>  Host to bind to (default: 0.0.0.0)
      --help         Show this help

ENVIRONMENT
  SABI_OPENAI_API_KEY       OpenAI API key
  SABI_GROQ_API_KEY         Groq API key
  SABI_ANTHROPIC_API_KEY    Anthropic API key
  SABI_GOOGLE_API_KEY       Google AI API key
  SABI_MISTRAL_API_KEY      Mistral API key
  SABI_DEEPSEEK_API_KEY     DeepSeek API key
  SABI_TOGETHER_API_KEY     Together API key
  SABI_NVIDIA_API_KEY       NVIDIA API key
  SABI_OPENROUTER_API_KEY   OpenRouter API key
  SABI_OLLAMA_API_KEY       Ollama API key
  SABI_API_KEY              Admin API key (all scopes)
  SABI_ADMIN_API_KEY        Dedicated key for /v1/admin endpoints
  SABI_API_KEYS             Scoped keys: key:scope1,scope2;key2
  SABI_PORT                 Port (default: 3000)
  SABI_HOST                 Host (default: 0.0.0.0)
  SABI_CORS_ORIGINS         CORS origins, comma-separated (default: *)
  SABI_RATE_LIMIT_RPM       Rate limit per minute (default: 300)
  SABI_IDEMPOTENCY_TTL      Idempotency key TTL in seconds (default: 86400)
`);
  process.exit(0);
}

const providers: Record<string, { apiKey: string }> = {};

for (const [name, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
  const val = process.env[envVar];
  if (val) {
    providers[name] = { apiKey: val };
  }
}

if (Object.keys(providers).length === 0) {
  log.error("No providers configured. Set at least one SABI_*_API_KEY env var.");
  process.exit(1);
}

const { createWeysabi } = await import("@weysabi/sabi");
const sabi = createWeysabi(providers);

const { createServer } = await import("./index");
const server = await createServer(sabi, {
  port: port ?? (process.env.SABI_PORT ? Number(process.env.SABI_PORT) : undefined),
  hostname: host ?? process.env.SABI_HOST,
  apiKey: process.env.SABI_API_KEY || undefined,
  adminApiKey: process.env.SABI_ADMIN_API_KEY || undefined,
  apiKeys: process.env.SABI_API_KEYS ? parseApiKeys(process.env.SABI_API_KEYS) : undefined,
  providers: Object.keys(providers),
});

const displayHost =
  server.hostname === "0.0.0.0" || server.hostname === "::" ? "localhost" : server.hostname;

log.info("Weysabi Server ready", {
  url: `http://${displayHost}:${server.port}`,
  providers: Object.keys(providers),
  auth: !!process.env.SABI_API_KEY || !!process.env.SABI_API_KEYS,
});

process.on("SIGINT", () => {
  log.info("Shutting down (SIGINT)");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down (SIGTERM)");
  server.stop();
  process.exit(0);
});
