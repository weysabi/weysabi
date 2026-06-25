import type { Weysabi } from "@weysabi/sabi";
import { AllModelsFailedError } from "@weysabi/sabi/errors";
import { InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";
import { InMemoryStore } from "@joinremba/gate/idempotency";
import { z } from "zod";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import { createAuth, createRateLimiter, createIdempotency, resolveApiKeys } from "./middleware";
import type { ApiKeyEntry, IdempotencyStore, RateLimitStore } from "./middleware";
import { IdempotencyConflictError, PayloadTooLargeError, ServerError } from "./errors";
import { ok, fail, fromServerError } from "./responses";
import { createModuleLogger } from "./logger";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  apiKey?: string;
  apiKeys?: ApiKeyEntry[];
  corsOrigins?: string[];
  rateLimitRpm?: number;
  providers?: string[];
  idempotencyTtl?: number;
  maxBodyBytes?: number;
  trustedProxies?: string[];
  getRemoteAddress?: (request: Request) => string | undefined;
  rateLimitStore?: RateLimitStore;
  idempotencyStore?: IdempotencyStore;
  closeSabiOnStop?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoApp = any;

function sseErrorEvent(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "sabi_error" } })}\n\n`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const log = createModuleLogger("routes");

export async function createRouter(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  close: () => void;
}> {
  let Hono: new () => HonoApp;
  try {
    const mod = await import("hono");
    Hono = mod.Hono;
  } catch {
    throw new Error("Hono is required for Weysabi Server. Install it: bun add hono");
  }
  const app = new Hono();
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();
  const idempotencyStore = options.idempotencyStore ?? new InMemoryStore();

  const corsOrigins = options.corsOrigins ?? ["*"];
  try {
    const { cors } = await import("hono/cors");
    app.use(
      "/*",
      cors({
        origin: corsOrigins.includes("*") ? "*" : corsOrigins,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
        exposeHeaders: ["Content-Length"],
        maxAge: 86400,
      })
    );
  } catch {
    // cors() is a no-op if Hono is too old
  }

  const apiKeys = resolveApiKeys(options.apiKey, options.apiKeys);
  if (apiKeys.length > 0) {
    app.use("/*", createAuth(apiKeys));
  }

  const rpm = options.rateLimitRpm ?? 300;
  app.use(
    "/*",
    createRateLimiter(
      rpm,
      {
        trustedProxies: options.trustedProxies,
        getRemoteAddress: options.getRemoteAddress,
      },
      rateLimitStore
    )
  );

  const { bodyLimit } = await import("hono/body-limit");
  app.use(
    "/v1/chat/completions",
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: () => {
        throw new PayloadTooLargeError(maxBodyBytes);
      },
    })
  );

  const idemp = createIdempotency(options.idempotencyTtl ?? 86400, idempotencyStore);

  app.use("/*", async (c: HonoApp, next: HonoApp) => {
    const start = Date.now();
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.get("/v1/models", (c: HonoApp) => {
    const providers = options.providers ?? [];
    const data =
      providers.length > 0
        ? providers.map((name) => ({
            id: `${name}/*`,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: name,
          }))
        : [
            {
              id: "sabi-proxy",
              object: "model",
              created: Math.floor(Date.now() / 1000),
              owned_by: "weysabi",
            },
          ];

    return ok(c, { object: "list", data });
  });

  app.get("/health", (c: HonoApp) => {
    return ok(c, { status: "ok", timestamp: Date.now() });
  });

  app.post("/v1/chat/completions", async (c: HonoApp) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const stream = body.stream === true;
    const rawIdempKey = c.req.header("Idempotency-Key");
    const [idempKey, requestFingerprint] =
      rawIdempKey && !stream
        ? await Promise.all([
            sha256(`${c.req.header("Authorization") ?? "anonymous"}:${rawIdempKey}`),
            sha256(JSON.stringify(body)),
          ])
        : [undefined, undefined];

    if (idempKey) {
      const cached = (await idemp.getResponse(idempKey)) as
        | { fingerprint: string; response: unknown }
        | undefined;
      if (cached) {
        if (cached.fingerprint !== requestFingerprint) {
          throw new IdempotencyConflictError();
        }
        log.info("idempotency hit", { key: idempKey });
        return ok(c, cached.response);
      }
    }

    const request = translateRequest(body);

    const start = Date.now();
    log.info("chat completion request", {
      method: stream ? "stream" : "complete",
      model: request.model,
    });

    if (stream) {
      const iterable = sabi.stream({ ...request, signal: c.req.raw.signal });
      const iterator = iterable[Symbol.asyncIterator]();
      const model = request.model as string;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              let next = await iterator.next();
              while (!next.done) {
                const chunk = next.value;
                const line = translateStreamChunk(chunk, model);
                controller.enqueue(new TextEncoder().encode(line));
                next = await iterator.next();
              }
              controller.close();
              log.info("stream complete", { model, latencyMs: Date.now() - start });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.error("stream error", { model, error: message });
              if (c.req.raw.signal.aborted) return;
              controller.enqueue(new TextEncoder().encode(sseErrorEvent(message)));
              controller.close();
            }
          },
          async cancel() {
            await iterator.return?.();
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
    }

    const response = await sabi.complete(request);
    const translated = translateResponse(response, request.model as string);

    if (idempKey && requestFingerprint) {
      await idemp.setResponse(idempKey, {
        fingerprint: requestFingerprint,
        response: translated,
      });
    }

    log.info("chat completion success", {
      model: request.model,
      latencyMs: Date.now() - start,
      tokens: response.usage?.totalTokens,
    });
    return ok(c, translated);
  });

  app.onError((err: Error, c: HonoApp) => {
    if (err instanceof ServerError) {
      log.warn("server error", {
        code: err.code,
        status: err.statusCode,
        path: c.req.path,
        method: c.req.method,
      });
      return fromServerError(c, err);
    }

    if (err instanceof AllModelsFailedError) {
      log.error("all models failed", { errors: err.errors });
      return fail(c, 502, err.message, "ALL_MODELS_FAILED");
    }

    if (err instanceof SyntaxError) {
      return fail(c, 400, "Request body must be valid JSON", "INVALID_JSON");
    }

    if (err instanceof z.ZodError) {
      return fail(c, 400, "Request validation failed", "VALIDATION_ERROR", err.issues);
    }

    log.error("unhandled error", {
      message: err.message,
      path: c.req.path,
      method: c.req.method,
    });
    return fail(c, 500, "Internal server error", "SERVER_ERROR");
  });

  app.notFound((c: HonoApp) => {
    const path = `${c.req.method} ${c.req.path}`;
    log.warn("not found", { path });
    return fail(c, 404, `Route ${path} not found`, "NOT_FOUND");
  });

  return {
    fetch: app.fetch as (req: Request) => Response | Promise<Response>,
    close: () => {
      if (!options.rateLimitStore && "dispose" in rateLimitStore) {
        (rateLimitStore as RateLimitStore & { dispose: () => void }).dispose();
      }
      if (!options.idempotencyStore && "dispose" in idempotencyStore) {
        (idempotencyStore as IdempotencyStore & { dispose: () => void }).dispose();
      }
    },
  };
}
