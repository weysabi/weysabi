import { createBeacon, ConfigValidationError } from "@joinremba/beacon";
import type { Beacon } from "@joinremba/beacon";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("config");

export function createServerConfig(): Beacon {
  return createBeacon({
    WEYSABI_PORT: { type: "port", default: 3000, description: "HTTP listen port" },
    WEYSABI_HOST: { type: "string", default: "0.0.0.0", description: "HTTP listen host" },
    WEYSABI_API_KEY: {
      type: "string",
      required: false,
      secret: true,
      description: "Admin API key (grants all scopes)",
    },
    WEYSABI_ADMIN_API_KEY: {
      type: "string",
      required: false,
      secret: true,
      description: "Dedicated API key for /v1/admin endpoints",
    },
    WEYSABI_API_KEYS: {
      type: "string",
      required: false,
      secret: true,
      description: "Semicolon-separated key:scope1,scope2 pairs",
    },
    WEYSABI_CORS_ORIGINS: {
      type: "string",
      required: false,
      default: "*",
      description: "Comma-separated allowed CORS origins",
    },
    WEYSABI_RATE_LIMIT_RPM: {
      type: "integer",
      default: 300,
      description: "Rate limit requests per minute",
    },
    WEYSABI_IDEMPOTENCY_TTL: {
      type: "integer",
      default: 86400,
      description: "Idempotency key TTL in seconds",
    },
    WEYSABI_MAX_BODY_BYTES: {
      type: "integer",
      default: 1048576,
      description: "Maximum request body size in bytes",
    },
    WEYSABI_TRUSTED_PROXIES: {
      type: "string",
      required: false,
      default: "",
      description: "Comma-separated direct proxy IP addresses trusted for forwarded headers",
    },
    WEYSABI_MODEL_ALIASES: {
      type: "string",
      required: false,
      description:
        "Comma-separated alias=provider/model pairs (e.g. weysabi-fast=groq/llama-4-scout)",
    },
    WEYSABI_OPENAI_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_GROQ_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_ANTHROPIC_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_GOOGLE_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_MISTRAL_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_DEEPSEEK_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_TOGETHER_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_NVIDIA_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_OPENROUTER_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_OLLAMA_API_KEY: { type: "string", required: false, secret: true },
    WEYSABI_STORAGE: {
      type: "string",
      required: false,
      default: "sqlite",
      description: "Storage backend: sqlite or postgres",
    },
    WEYSABI_DATABASE_URL: {
      type: "string",
      required: false,
      secret: true,
      description: "Postgres connection string (required when storage=postgres)",
    },
    WEYSABI_REDIS_URL: {
      type: "string",
      required: false,
      secret: true,
      description: "Redis connection string (optional)",
    },
    WEYSABI_AUTH_URL: {
      type: "string",
      required: false,
      description: "Public URL for auth callbacks (default: http://localhost:<port>)",
    },
    WEYSABI_AUTH_SECRET: {
      type: "string",
      required: false,
      secret: true,
      description: "Auth session secret (default: auto-generated)",
    },
  });
}

export function validateOrExit(): Beacon | null {
  const config = createServerConfig();
  try {
    config.ensure({ strict: false });
    log.info("config validated", {
      port: config.get<number>("WEYSABI_PORT"),
      auth: !!(config.get<string>("WEYSABI_API_KEY") || config.get<string>("WEYSABI_API_KEYS")),
      rateLimitRpm: config.get<number>("WEYSABI_RATE_LIMIT_RPM"),
      cors: config.get<string>("WEYSABI_CORS_ORIGINS"),
    });
    return config;
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      for (const e of err.errors) {
        log.error("config error", { key: e.key, message: e.message });
      }
    } else {
      log.error("config validation failed", { error: String(err) });
    }
    return null;
  }
}
