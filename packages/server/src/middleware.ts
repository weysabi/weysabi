import { createApiKeyValidator } from "@joinremba/gate/api-keys";
import type { ApiKeyEntry } from "@joinremba/gate/api-keys";
import { rateLimit, InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";
import type { RateLimitStore } from "@joinremba/gate/rate-limit";
import { idempotency, InMemoryStore } from "@joinremba/gate/idempotency";
import type { IdempotencyInstance, IdempotencyStore } from "@joinremba/gate/idempotency";
import { AuthError, InsufficientPermissionsError, RateLimitError } from "./errors";
import { fingerprintRequestApiKey } from "./quota";

export type { ApiKeyEntry };
export type { IdempotencyInstance, IdempotencyStore, RateLimitStore };

export interface RateLimiterOptions {
  trustedProxies?: string[];
  getRemoteAddress?: (request: Request) => string | undefined;
}

export function parseApiKeys(raw: string): ApiKeyEntry[] {
  return raw.split(";").map((entry) => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) {
      return { key: entry.trim() };
    }
    const key = entry.slice(0, colonIdx).trim();
    const scopes = entry
      .slice(colonIdx + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { key, scopes: scopes.length > 0 ? scopes : undefined };
  });
}

export function resolveApiKeys(apiKey?: string, apiKeys?: ApiKeyEntry[]): ApiKeyEntry[] {
  const keys: ApiKeyEntry[] = [];
  if (apiKey) {
    keys.push({ key: apiKey, scopes: ["admin"] });
  }
  if (apiKeys) {
    keys.push(...apiKeys);
  }
  const envKeys = process.env.WEYSABI_API_KEYS;
  if (apiKey === undefined && apiKeys === undefined && envKeys) {
    keys.push(...parseApiKeys(envKeys));
  }
  return keys;
}

function getScopeForPath(method: string, path: string): string[] | null {
  if (path === "/v1/chat/completions" && method === "POST") return ["chat:write"];
  if (path.startsWith("/v1/models")) return ["models:read"];
  if (path.startsWith("/v1/admin")) return ["admin"];
  return null;
}

export interface AuthMiddlewareOptions {
  skipProjectRoutes?: boolean;
}

export function createAuth(keys: ApiKeyEntry[], options: AuthMiddlewareOptions = {}) {
  const validator = createApiKeyValidator(keys);
  const authenticate = validator.authenticate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    if (c.req.path === "/health" || c.req.path === "/metrics") {
      await next();
      return;
    }
    if (c.req.path.startsWith("/v1/admin")) {
      await next();
      return;
    }
    if (
      options.skipProjectRoutes &&
      (c.req.path === "/v1/projects" || c.req.path.startsWith("/v1/projects/"))
    ) {
      await next();
      return;
    }

    const result = await authenticate(c.req.raw);
    if (!result.authenticated) {
      throw new AuthError();
    }

    const required = getScopeForPath(c.req.method, c.req.path);
    if (required) {
      const userScopes = result.scopes ?? [];
      const missing = required.filter(
        (s: string) => !userScopes.includes(s) && !userScopes.includes("admin")
      );
      if (missing.length > 0) {
        throw new InsufficientPermissionsError(missing[0]!);
      }
    }

    await next();
  };
}

export function createAdminAuth(apiKey: string, nonAdminKeys: ApiKeyEntry[] = []) {
  const authenticate = createApiKeyValidator([{ key: apiKey, scopes: ["admin"] }]).authenticate();
  const authenticateNonAdmin = createApiKeyValidator(nonAdminKeys).authenticate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    const result = await authenticate(c.req.raw);
    if (!result.authenticated) {
      const nonAdminResult = await authenticateNonAdmin(c.req.raw);
      if (nonAdminResult.authenticated) {
        throw new InsufficientPermissionsError("admin");
      }
      throw new AuthError("Incorrect admin API key provided");
    }
    await next();
  };
}

export function resolveClientIp(
  request: Request,
  remoteAddress: string | undefined,
  trustedProxies: string[] = []
): string {
  if (!remoteAddress) return "unknown";

  const trusted = new Set(trustedProxies);
  if (!trusted.has(remoteAddress)) return remoteAddress;

  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const chain = [...(forwarded ?? []), remoteAddress];

  for (let index = chain.length - 1; index >= 0; index--) {
    const address = chain[index]!;
    if (!trusted.has(address)) return address;
  }

  return request.headers.get("x-real-ip")?.trim() || remoteAddress;
}

export function createRateLimiter(
  rpm: number,
  options: RateLimiterOptions = {},
  store: RateLimitStore = new InMemoryRateLimitStore()
) {
  const limiter = rateLimit({
    max: rpm,
    store,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    if (c.req.path === "/health" || c.req.path === "/metrics") {
      await next();
      return;
    }
    const request = c.req.raw as Request;
    const keyFingerprint = await fingerprintRequestApiKey(request);
    const key = keyFingerprint
      ? `key:${keyFingerprint}`
      : `ip:${resolveClientIp(
          request,
          options.getRemoteAddress?.(request),
          options.trustedProxies
        )}`;
    const result = await limiter.check(key);
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
      throw new RateLimitError(retryAfter);
    }

    await next();
  };
}

export function createIdempotency(
  ttlSeconds: number,
  store: IdempotencyStore = new InMemoryStore()
): IdempotencyInstance {
  return idempotency({
    store,
    ttl: ttlSeconds * 1000,
  });
}
