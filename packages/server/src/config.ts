import { createBeacon, ConfigValidationError } from "@joinremba/beacon";
import type { Beacon } from "@joinremba/beacon";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("config");

export function createServerConfig(): Beacon {
  return createBeacon({
    SABI_PORT: { type: "port", default: 3000, description: "HTTP listen port" },
    SABI_API_KEY: {
      type: "string",
      required: false,
      secret: true,
      description: "Admin API key (grants all scopes)",
    },
    SABI_API_KEYS: {
      type: "string",
      required: false,
      secret: true,
      description: "Semicolon-separated key:scope1,scope2 pairs",
    },
    SABI_CORS_ORIGINS: {
      type: "string",
      required: false,
      default: "*",
      description: "Comma-separated allowed CORS origins",
    },
    SABI_RATE_LIMIT_RPM: {
      type: "integer",
      default: 300,
      description: "Rate limit requests per minute",
    },
    SABI_IDEMPOTENCY_TTL: {
      type: "integer",
      default: 86400,
      description: "Idempotency key TTL in seconds",
    },
    SABI_OPENAI_API_KEY: { type: "string", required: false, secret: true },
    SABI_GROQ_API_KEY: { type: "string", required: false, secret: true },
    SABI_ANTHROPIC_API_KEY: { type: "string", required: false, secret: true },
    SABI_GOOGLE_API_KEY: { type: "string", required: false, secret: true },
    SABI_MISTRAL_API_KEY: { type: "string", required: false, secret: true },
    SABI_DEEPSEEK_API_KEY: { type: "string", required: false, secret: true },
    SABI_TOGETHER_API_KEY: { type: "string", required: false, secret: true },
    SABI_NVIDIA_API_KEY: { type: "string", required: false, secret: true },
    SABI_OPENROUTER_API_KEY: { type: "string", required: false, secret: true },
    SABI_OLLAMA_API_KEY: { type: "string", required: false, secret: true },
  });
}

export function validateOrExit(): Beacon | null {
  const config = createServerConfig();
  try {
    config.ensure({ strict: false });
    log.info("config validated", {
      port: config.get<number>("SABI_PORT"),
      auth: !!(config.get<string>("SABI_API_KEY") || config.get<string>("SABI_API_KEYS")),
      rateLimitRpm: config.get<number>("SABI_RATE_LIMIT_RPM"),
      cors: config.get<string>("SABI_CORS_ORIGINS"),
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
