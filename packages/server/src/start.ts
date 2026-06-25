import { createWeysabi } from "@weysabi/sabi";
import { createServer } from "./index";
import { validateOrExit } from "./config";
import { parseApiKeys } from "./middleware";
import { log } from "./logger";

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

const config = validateOrExit();
if (!config) {
  process.exit(1);
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

const sabi = createWeysabi(providers);

const port = config.get<number>("SABI_PORT");
const hostname = config.get<string>("SABI_HOST");
const apiKey = config.get<string>("SABI_API_KEY") || undefined;
const apiKeys = process.env.SABI_API_KEYS ? parseApiKeys(process.env.SABI_API_KEYS) : undefined;
const corsOrigins = config
  .get<string>("SABI_CORS_ORIGINS")
  .split(",")
  .map((s: string) => s.trim());
const rateLimitRpm = config.get<number>("SABI_RATE_LIMIT_RPM");
const idempotencyTtl = config.get<number>("SABI_IDEMPOTENCY_TTL");
const maxBodyBytes = config.get<number>("SABI_MAX_BODY_BYTES");
const trustedProxies = config
  .get<string>("SABI_TRUSTED_PROXIES")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const server = await createServer(sabi, {
  port,
  hostname,
  apiKey,
  apiKeys,
  corsOrigins,
  rateLimitRpm,
  providers: Object.keys(providers),
  idempotencyTtl,
  maxBodyBytes,
  trustedProxies,
});

log.info("Weysabi Server ready", {
  port: server.port,
  hostname: server.hostname,
  providers: Object.keys(providers),
  auth: !!apiKey || !!apiKeys,
  rateLimitRpm,
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
