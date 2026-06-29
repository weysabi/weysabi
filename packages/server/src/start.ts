import { createWeysabi } from "weysabi";
import { createServer } from "./index";
import { validateOrExit } from "./config";
import { parseApiKeys } from "./middleware";
import { log } from "./logger";
import {
  resolveProvidersFromEnv,
  requireProviders,
  registerShutdownHandlers,
  providerNames,
} from "./bootstrap";

const providers = resolveProvidersFromEnv();
requireProviders(providers);

const weysabi = createWeysabi(providers);

const config = validateOrExit();
if (!config) {
  process.exit(1);
}

const port = config.get<number>("WEYSABI_PORT");
const hostname = config.get<string>("WEYSABI_HOST");
const apiKey = config.get<string>("WEYSABI_API_KEY") || undefined;
const adminApiKey = config.get<string>("WEYSABI_ADMIN_API_KEY") || undefined;
const apiKeys = process.env.WEYSABI_API_KEYS
  ? parseApiKeys(process.env.WEYSABI_API_KEYS)
  : undefined;
const corsOrigins = config
  .get<string>("WEYSABI_CORS_ORIGINS")
  .split(",")
  .map((s: string) => s.trim());
const rateLimitRpm = config.get<number>("WEYSABI_RATE_LIMIT_RPM");
const idempotencyTtl = config.get<number>("WEYSABI_IDEMPOTENCY_TTL");
const maxBodyBytes = config.get<number>("WEYSABI_MAX_BODY_BYTES");
const trustedProxies = config
  .get<string>("WEYSABI_TRUSTED_PROXIES")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const storage = (process.env.WEYSABI_STORAGE ?? "sqlite") as "sqlite" | "postgres";
const server = await createServer(weysabi, {
  port,
  hostname,
  apiKey,
  adminApiKey,
  apiKeys,
  corsOrigins,
  rateLimitRpm,
  providers: providerNames(providers),
  idempotencyTtl,
  maxBodyBytes,
  trustedProxies,
  storage,
  databaseUrl: process.env.WEYSABI_DATABASE_URL || undefined,
  redisUrl: process.env.WEYSABI_REDIS_URL || undefined,
  controlPlane: true,
});

log.info("Weysabi Server ready", {
  port: server.port,
  hostname: server.hostname,
  providers: providerNames(providers),
  auth: !!apiKey || !!apiKeys,
  rateLimitRpm,
});

registerShutdownHandlers(() => server.stop());
