import type { Weysabi } from "weysabi";
import { AllModelsFailedError } from "weysabi/errors";
import { InMemoryRateLimitStore } from "@joinremba/gate/rate-limit";
import { InMemoryStore } from "@joinremba/gate/idempotency";
import { z } from "zod";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import {
  createAdminAuth,
  createAuth,
  createRateLimiter,
  createIdempotency,
  resolveApiKeys,
} from "./middleware";
import type { ApiKeyEntry, IdempotencyStore, RateLimitStore } from "./middleware";
import {
  IdempotencyConflictError,
  PayloadTooLargeError,
  ServerError,
  QuotaExceededError,
  errorMessage,
} from "./errors";
import { buildModelAliases, resolveAlias, getAliasesList } from "./aliases";
import type { ModelAlias, ModelAliasMap } from "./aliases";
import { ok, fail, fromServerError } from "./responses";
import { createModuleLogger } from "./logger";
import { InMemoryTokenQuotaStore, fingerprintRequestApiKey } from "./quota";
import type { QuotaReservation, TokenQuotaConfig, TokenQuotaStore } from "./quota";
import { InMemoryUsageLedger } from "./ledger";
import type { UsageLedger } from "./ledger";
import type { Hono } from "hono";
import type { Context } from "hono";
import { registerControlRoutes } from "./control/control-routes";
import { createRagService } from "./control/rag-service";
import type { RagManagerConfig } from "./control/rag-service";
import { createControlPlaneAuth } from "./control/auth";
import { ControlError } from "./control/errors";
import type { ControlPlaneStore } from "./control/store";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  apiKey?: string;
  adminApiKey?: string;
  apiKeys?: ApiKeyEntry[];
  corsOrigins?: string[];
  rateLimitRpm?: number;
  providers?: string[];
  modelAliases?: ModelAlias[];
  quotaConfig?: TokenQuotaConfig;
  quotaStore?: TokenQuotaStore;
  usageLedger?: UsageLedger;
  idempotencyTtl?: number;
  maxBodyBytes?: number;
  trustedProxies?: string[];
  getRemoteAddress?: (request: Request) => string | undefined;
  rateLimitStore?: RateLimitStore;
  idempotencyStore?: IdempotencyStore;
  closeSabiOnStop?: boolean;
  controlPlaneStore?: ControlPlaneStore;
  controlPlane?: boolean;
  storage?: "sqlite" | "postgres";
  databaseUrl?: string;
  redisUrl?: string;
  authHandler?: (request: Request) => Response | Promise<Response>;
  ragConfig?: RagManagerConfig;
}

type HonoApp = Hono;

function sseErrorEvent(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "weysabi_error" } })}\n\n`;
}

function estimateRequestTokens(request: {
  messages?: Array<{ content?: string | null }>;
  maxTokens?: number;
}): number {
  const promptCharacters = (request.messages ?? []).reduce(
    (sum, message) => sum + (message.content?.length ?? 0),
    0
  );
  const promptTokens = Math.max(1, Math.ceil(promptCharacters / 4));
  return promptTokens + (request.maxTokens ?? 1024);
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const log = createModuleLogger("routes");

const AdminUsageQuerySchema = z.object({
  key: z
    .string()
    .regex(/^[a-f0-9]{64}$/u, "key must be a SHA-256 fingerprint")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function createRouter(
  weysabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  close: () => void;
}> {
  let HonoCtor: new () => HonoApp;
  try {
    const mod = await import("hono");
    HonoCtor = mod.Hono;
  } catch {
    throw new Error("Hono is required for Weysabi Server. Install it: bun add hono");
  }
  const app = new HonoCtor();
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();
  const idempotencyStore = options.idempotencyStore ?? new InMemoryStore();

  const modelAliases: ModelAliasMap = buildModelAliases(options.modelAliases);
  const quotaStore: TokenQuotaStore = options.quotaStore ?? new InMemoryTokenQuotaStore();
  const quotaConfig = options.quotaConfig;
  const usageLedger: UsageLedger = options.usageLedger ?? new InMemoryUsageLedger();

  const corsOrigins = options.corsOrigins ?? ["*"];
  try {
    const { cors } = await import("hono/cors");
    app.use(
      "/*",
      cors({
        origin: corsOrigins.includes("*") ? "*" : corsOrigins,
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
        exposeHeaders: ["Content-Length"],
        maxAge: 86400,
        credentials: true,
      })
    );
  } catch {
    // cors() is a no-op if Hono is too old
  }

  if (options.authHandler) {
    app.on(["POST", "GET"], "/api/auth/*", (c) => {
      return options.authHandler!(c.req.raw);
    });
  }

  const apiKeys = resolveApiKeys(options.apiKey, options.apiKeys);
  const authApiKeys =
    apiKeys.length > 0 && options.adminApiKey
      ? [{ key: options.adminApiKey, scopes: ["admin"] }, ...apiKeys]
      : apiKeys;
  const hasControlPlane = Boolean(options.controlPlaneStore && options.adminApiKey);
  if (authApiKeys.length > 0) {
    app.use("/*", createAuth(authApiKeys, { skipProjectRoutes: hasControlPlane }));
  }
  if (options.adminApiKey) {
    app.use("/v1/admin/*", createAdminAuth(options.adminApiKey, apiKeys));
    if (options.controlPlaneStore) {
      const controlAuth = createControlPlaneAuth(
        options.adminApiKey,
        apiKeys,
        options.controlPlaneStore
      );
      app.use("/v1/projects", controlAuth);
      app.use("/v1/projects/*", controlAuth);
    } else {
      app.use("/v1/projects", createAdminAuth(options.adminApiKey, apiKeys));
      app.use("/v1/projects/*", createAdminAuth(options.adminApiKey, apiKeys));
    }
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
  app.use(
    "/v1/projects",
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: () => {
        throw new PayloadTooLargeError(maxBodyBytes);
      },
    })
  );
  app.use(
    "/v1/projects/*",
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: () => {
        throw new PayloadTooLargeError(maxBodyBytes);
      },
    })
  );

  const idemp = createIdempotency(options.idempotencyTtl ?? 86400, idempotencyStore);

  app.use("/*", async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.get("/v1/models", (c: Context) => {
    const providers = options.providers ?? [];
    const data: Record<string, unknown>[] =
      providers.length > 0
        ? providers.map((name) => ({
            id: `${name}/*`,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: name,
          }))
        : [
            {
              id: "weysabi-proxy",
              object: "model",
              created: Math.floor(Date.now() / 1000),
              owned_by: "weysabi",
            },
          ];

    const aliases = getAliasesList(modelAliases);
    for (const { alias, model } of aliases) {
      data.push({
        id: alias,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: model,
      });
    }

    return ok(c, { object: "list", data });
  });

  app.get("/health", (c: Context) => {
    return ok(c, { status: "ok", timestamp: Date.now() });
  });

  if (options.adminApiKey) {
    app.get("/v1/admin/stats", async (c: Context) => {
      const allStats = await usageLedger.stats();

      return ok(c, {
        totalRequests: allStats.totalRequests,
        totalTokens: allStats.totalTokens,
        totalCostUsd: allStats.totalCostUsd,
        activeKeys: allStats.activeKeys,
      });
    });

    app.get("/v1/admin/usage", async (c: Context) => {
      const query = AdminUsageQuerySchema.parse({
        key: c.req.query("key") || undefined,
        limit: c.req.query("limit") || undefined,
        offset: c.req.query("offset") || undefined,
      });

      const result = await usageLedger.query({
        keyFingerprint: query.key,
        limit: query.limit,
        offset: query.offset,
      });
      return ok(c, result);
    });
  }

  let ragService: ReturnType<typeof createRagService> | undefined;
  if (options.controlPlaneStore && options.adminApiKey) {
    const hasQuotaLimits =
      quotaConfig?.maxTokensPerMin !== undefined || quotaConfig?.maxTokensPerDay !== undefined;
    ragService = options.ragConfig ? createRagService(options.ragConfig) : undefined;
    registerControlRoutes(app, weysabi, options.controlPlaneStore, {
      idempotency: idemp,
      ...(options.quotaStore || hasQuotaLimits ? { quotaStore, quotaConfig } : {}),
      ragService,
    });
  }

  app.post("/v1/chat/completions", async (c: Context) => {
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
    request.model = resolveAlias(modelAliases, request.model as string);
    if (request.fallbacks) {
      request.fallbacks = request.fallbacks.map((model) => resolveAlias(modelAliases, model));
    }
    const keyFingerprint = await fingerprintRequestApiKey(c.req.raw);
    let quotaReservation: QuotaReservation | undefined;

    if (quotaConfig && keyFingerprint) {
      const result = await quotaStore.reserve(
        keyFingerprint,
        estimateRequestTokens(request),
        quotaConfig
      );
      if (!result.allowed) {
        throw new QuotaExceededError(result.reason);
      }
      quotaReservation = result.reservation;
    }

    const start = Date.now();
    log.info("chat completion request", {
      method: stream ? "stream" : "complete",
      model: request.model,
    });

    if (stream) {
      const iterable = weysabi.stream({ ...request, signal: c.req.raw.signal });
      const iterator = iterable[Symbol.asyncIterator]();
      const model = request.model as string;
      let quotaSettled = false;
      const commitQuota = async (actualTokens?: number) => {
        if (!quotaReservation || quotaSettled) return;
        quotaSettled = true;
        await quotaStore.commit(
          quotaReservation.id,
          actualTokens ?? quotaReservation.reservedTokens
        );
      };
      const releaseQuota = async () => {
        if (!quotaReservation || quotaSettled) return;
        quotaSettled = true;
        await quotaStore.release(quotaReservation.id);
      };
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              let next = await iterator.next();
              while (!next.done) {
                const chunk = next.value;
                if (chunk.done && chunk.usage?.totalTokens && keyFingerprint) {
                  await commitQuota(chunk.usage.totalTokens);
                  await usageLedger.record({
                    keyFingerprint,
                    model,
                    promptTokens: chunk.usage.promptTokens,
                    completionTokens: chunk.usage.completionTokens,
                    totalTokens: chunk.usage.totalTokens,
                    timestamp: Date.now(),
                    status: "success",
                  });
                }
                const line = translateStreamChunk(chunk, model);
                controller.enqueue(new TextEncoder().encode(line));
                next = await iterator.next();
              }
              await commitQuota();
              controller.close();
              log.info("stream complete", { model, latencyMs: Date.now() - start });
            } catch (err) {
              await releaseQuota();
              const msg = errorMessage(err);
              log.error("stream error", { model, error: msg });
              if (c.req.raw.signal.aborted) return;
              controller.enqueue(new TextEncoder().encode(sseErrorEvent(msg)));
              controller.close();
            }
          },
          async cancel() {
            await releaseQuota();
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

    let response;
    try {
      response = await weysabi.complete(request);
    } catch (err) {
      if (quotaReservation) await quotaStore.release(quotaReservation.id);
      throw err;
    }
    const translated = translateResponse(response, request.model as string);

    if (quotaReservation) {
      await quotaStore.commit(
        quotaReservation.id,
        response.usage?.totalTokens ?? quotaReservation.reservedTokens
      );
    }

    if (keyFingerprint && response.usage?.totalTokens) {
      await usageLedger.record({
        keyFingerprint,
        model: request.model as string,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        timestamp: Date.now(),
        status: "success",
      });
    }

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

  app.onError((err: Error, c: Context) => {
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

    if (err instanceof ControlError) {
      log.warn("control error", {
        code: err.code,
        status: err.statusCode,
        path: c.req.path,
        method: c.req.method,
      });
      return fail(c, err.statusCode, err.message, err.code);
    }

    log.error("unhandled error", {
      message: err.message,
      path: c.req.path,
      method: c.req.method,
    });
    return fail(c, 500, "Internal server error", "SERVER_ERROR");
  });

  app.notFound((c: Context) => {
    const path = `${c.req.method} ${c.req.path}`;
    log.warn("not found", { path });
    return fail(c, 404, `Route ${path} not found`, "NOT_FOUND");
  });

  return {
    fetch: app.fetch as (req: Request) => Response | Promise<Response>,
    close: () => {
      ragService?.close();
      if (!options.rateLimitStore && "dispose" in rateLimitStore) {
        (rateLimitStore as RateLimitStore & { dispose: () => void }).dispose();
      }
      if (!options.idempotencyStore && "dispose" in idempotencyStore) {
        (idempotencyStore as IdempotencyStore & { dispose: () => void }).dispose();
      }
      if (!options.quotaStore) {
        const qs = quotaStore as { close?: () => void };
        if (qs && typeof qs.close === "function") qs.close();
      }
      if (!options.usageLedger) {
        const ul = usageLedger as { close?: () => void };
        if (ul && typeof ul.close === "function") ul.close();
      }
    },
  };
}
