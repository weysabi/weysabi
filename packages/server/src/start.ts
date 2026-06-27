import { createWeysabi } from "@weysabi/sabi";
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

const sabi = createWeysabi(providers);

const config = validateOrExit();
if (!config) {
  process.exit(1);
}

const port = config.get<number>("SABI_PORT");
const hostname = config.get<string>("SABI_HOST");
const apiKey = config.get<string>("SABI_API_KEY") || undefined;
const adminApiKey = config.get<string>("SABI_ADMIN_API_KEY") || undefined;
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
  adminApiKey,
  apiKeys,
  corsOrigins,
  rateLimitRpm,
  providers: providerNames(providers),
  idempotencyTtl,
  maxBodyBytes,
  trustedProxies,
});

log.info("Weysabi Server ready", {
  port: server.port,
  hostname: server.hostname,
  providers: providerNames(providers),
  auth: !!apiKey || !!apiKeys,
  rateLimitRpm,
});

registerShutdownHandlers(() => server.stop());
