import type { Weysabi } from "@weysabi/sabi";
import { AllModelsFailedError } from "@weysabi/sabi/errors";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import { createAuth, createRateLimiter, createIdempotency, resolveApiKeys } from "./middleware";
import type { ApiKeyEntry } from "./middleware";
import { ServerError } from "./errors";
import { ok, fail, fromServerError } from "./responses";
import { createModuleLogger } from "./logger";

export interface ServerOptions {
  port?: number;
  apiKey?: string;
  apiKeys?: ApiKeyEntry[];
  corsOrigins?: string[];
  rateLimitRpm?: number;
  providers?: string[];
  idempotencyTtl?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoApp = any;

function sseErrorEvent(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "sabi_error" } })}\n\n`;
}

const log = createModuleLogger("routes");

export async function createRouter(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{ fetch: (req: Request) => Response | Promise<Response> }> {
  let Hono: new () => HonoApp;
  try {
    const mod = await import("hono");
    Hono = mod.Hono;
  } catch {
    throw new Error("Hono is required for Weysabi Server. Install it: bun add hono");
  }
  const app = new Hono();

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
  app.use("/*", createRateLimiter(rpm));

  const idemp = createIdempotency(options.idempotencyTtl ?? 86400);

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
    const idempKey = c.req.header("Idempotency-Key");

    if (idempKey && !stream) {
      const cached = await idemp.getResponse(idempKey);
      if (cached) {
        log.info("idempotency hit", { key: idempKey });
        return ok(c, cached);
      }
    }

    const request = translateRequest(body);

    const start = Date.now();
    log.info("chat completion request", {
      method: stream ? "stream" : "complete",
      model: request.model,
    });

    if (stream) {
      const iterable = sabi.stream(request);
      const model = request.model as string;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              for await (const chunk of iterable) {
                const line = translateStreamChunk(chunk, model);
                controller.enqueue(new TextEncoder().encode(line));
              }
              controller.close();
              log.info("stream complete", { model, latencyMs: Date.now() - start });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.error("stream error", { model, error: message });
              controller.enqueue(new TextEncoder().encode(sseErrorEvent(message)));
              controller.close();
            }
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

    if (idempKey) {
      await idemp.setResponse(idempKey, translated);
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

  return { fetch: app.fetch as (req: Request) => Response | Promise<Response> };
}
