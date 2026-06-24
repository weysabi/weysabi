import { createApiKeyValidator } from "@joinremba/gate/api-keys";
import { rateLimit, InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";

export function createAuth(apiKey: string) {
  const validator = createApiKeyValidator([{ key: apiKey }]);
  const authenticate = validator.authenticate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: any) => {
    if (c.req.path === "/health") {
      await next();
      return;
    }

    const result = await authenticate(c.req.raw);
    if (!result.authenticated) {
      return c.json(
        {
          error: {
            message:
              "Incorrect API key provided. Set SABI_API_KEY or pass via Authorization header.",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        401,
        { "WWW-Authenticate": "Bearer" }
      );
    }

    await next();
  };
}

export function createRateLimiter(rpm: number) {
  const limiter = rateLimit({
    max: rpm,
    store: new InMemoryRateLimitStore(),
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
      return c.json(
        {
          error: {
            message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
          },
        },
        429,
        {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": "0",
        }
      );
    }

    await next();
  };
}
