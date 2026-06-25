import { createApiKeyValidator } from "@joinremba/gate/api-keys";
import type { ApiKeyEntry } from "@joinremba/gate/api-keys";
import { rateLimit, InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";
import { idempotency, InMemoryStore } from "@joinremba/gate/idempotency";
import type { IdempotencyInstance } from "@joinremba/gate/idempotency";
import { AuthError, InsufficientPermissionsError, RateLimitError } from "./errors";

export type { ApiKeyEntry };
export type { IdempotencyInstance };

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
  const envKeys = process.env.SABI_API_KEYS;
  if (apiKey === undefined && apiKeys === undefined && envKeys) {
    keys.push(...parseApiKeys(envKeys));
  }
  return keys;
}

function getScopeForPath(method: string, path: string): string[] | null {
  if (path === "/v1/chat/completions" && method === "POST") return ["chat:write"];
  if (path.startsWith("/v1/models")) return ["models:read"];
  return null;
}

export function createAuth(keys: ApiKeyEntry[]) {
  const validator = createApiKeyValidator(keys);
  const authenticate = validator.authenticate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    if (c.req.path === "/health") {
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

export function createRateLimiter(rpm: number) {
  const store = new InMemoryRateLimitStore();
  const limiter = rateLimit({
    max: rpm,
    store,
    keyFn: (req: Request) => {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      return `ip:${ip}`;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    const result = await limiter.check(c.req.raw);
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
      throw new RateLimitError(retryAfter);
    }

    await next();
  };
}

export function createIdempotency(ttlSeconds: number): IdempotencyInstance {
  return idempotency({
    store: new InMemoryStore(),
    ttl: ttlSeconds * 1000,
  });
}
