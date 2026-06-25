import type { Weysabi } from "@weysabi/sabi";
import { createRouter, type ServerOptions } from "./routes";

export type { ServerOptions };

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export async function createServer(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
  stop: () => void;
}> {
  const apiKey = options.apiKey ?? process.env.SABI_API_KEY;
  const adminApiKey = options.adminApiKey ?? process.env.SABI_ADMIN_API_KEY;
  const apiKeys = options.apiKeys;
  const port = options.port ?? envInteger("SABI_PORT", 3000);
  const hostname = options.hostname ?? process.env.SABI_HOST ?? "0.0.0.0";
  const corsOrigins =
    options.corsOrigins ??
    (process.env.SABI_CORS_ORIGINS
      ? process.env.SABI_CORS_ORIGINS.split(",").map((s) => s.trim())
      : ["*"]);
  const rateLimitRpm = options.rateLimitRpm ?? envInteger("SABI_RATE_LIMIT_RPM", 300);
  const idempotencyTtl = options.idempotencyTtl ?? envInteger("SABI_IDEMPOTENCY_TTL", 86400);
  const maxBodyBytes = options.maxBodyBytes ?? envInteger("SABI_MAX_BODY_BYTES", 1024 * 1024);
  const trustedProxies =
    options.trustedProxies ??
    (process.env.SABI_TRUSTED_PROXIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const remoteAddresses = new WeakMap<Request, string>();

  const router = await createRouter(sabi, {
    port,
    apiKey,
    adminApiKey,
    apiKeys,
    corsOrigins,
    rateLimitRpm,
    providers: options.providers,
    modelAliases: options.modelAliases,
    quotaConfig: options.quotaConfig,
    quotaStore: options.quotaStore,
    usageLedger: options.usageLedger,
    idempotencyTtl,
    maxBodyBytes,
    trustedProxies,
    rateLimitStore: options.rateLimitStore,
    idempotencyStore: options.idempotencyStore,
    getRemoteAddress: (request) => remoteAddresses.get(request),
  });

  const server = Bun.serve({
    port,
    hostname,
    fetch(req, server) {
      const address = server.requestIP(req)?.address;
      if (address) remoteAddresses.set(req, address);
      return router.fetch(req);
    },
  });

  let stopped = false;
  return {
    fetch: router.fetch as (req: Request) => Response | Promise<Response>,
    port: server.port as number,
    hostname,
    stop: () => {
      if (stopped) return;
      stopped = true;
      server.stop();
      router.close();
      if (options.closeSabiOnStop !== false) {
        sabi.close?.();
      }
    },
  };
}

export type { ApiKeyEntry, IdempotencyStore, RateLimitStore } from "./middleware";
export { buildModelAliases, getAliasesList, resolveAlias } from "./aliases";
export type { ModelAlias, ModelAliasMap } from "./aliases";
export { fingerprintApiKey, fingerprintRequestApiKey, InMemoryTokenQuotaStore } from "./quota";
export type {
  QuotaReservation,
  QuotaReservationResult,
  TokenQuotaConfig,
  TokenQuotaStore,
} from "./quota";
export { InMemoryUsageLedger } from "./ledger";
export type { UsageLedger, UsageRecord } from "./ledger";
export {
  RedisIdempotencyStore,
  RedisRateLimitStore,
  fromIORedis,
} from "@joinremba/gate/stores/redis";
export type { RedisClient } from "@joinremba/gate/stores/redis";
export { translateRequest, translateResponse, translateStreamChunk } from "./translate";
