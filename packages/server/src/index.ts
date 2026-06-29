import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import type { Weysabi } from "weysabi";
import { createRouter, type ServerOptions } from "./routes";
import { createPostgresControlPlaneStore, createSqliteControlPlaneStore } from "./control";
import { InMemoryTokenQuotaStore, SqliteTokenQuotaStore, fingerprintApiKey } from "./quota";
import type { TokenQuotaStore } from "./quota";
import { InMemoryUsageLedger, SqliteUsageLedger } from "./ledger";
import type { UsageLedger } from "./ledger";
import { createModuleLogger } from "./logger";
import { createWsHandler } from "./ws";
import { buildModelAliases } from "./aliases";
const log = createModuleLogger("server");

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

function resolveControlPlaneStore(options: ServerOptions) {
  const explicit = options.controlPlaneStore;
  if (explicit) return explicit;
  if (!options.controlPlane) return undefined;

  if (options.storage === "postgres") {
    const connectionString = options.databaseUrl ?? process.env.WEYSABI_DATABASE_URL;
    if (!connectionString) {
      throw new Error("WEYSABI_DATABASE_URL is required when storage is 'postgres'");
    }
    return createPostgresControlPlaneStore({ connectionString });
  }

  const dbPath = resolve(
    process.env.WEYSABI_CONTROL_DB ??
      (options.storage === "sqlite" ? ".weysabi/control.db" : ".weysabi/control.db")
  );
  mkdirSync(dirname(dbPath), { recursive: true });
  return createSqliteControlPlaneStore(dbPath);
}

async function resolveQuotaStore(options: ServerOptions): Promise<TokenQuotaStore> {
  if (options.quotaStore) return options.quotaStore;
  if (options.storage === "sqlite") {
    const dbPath = resolve(process.env.WEYSABI_QUOTA_DB ?? ".weysabi/quota.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    return SqliteTokenQuotaStore.create(dbPath);
  }
  return new InMemoryTokenQuotaStore();
}

async function resolveUsageLedger(options: ServerOptions): Promise<UsageLedger> {
  if (options.usageLedger) return options.usageLedger;
  if (options.storage === "sqlite") {
    const dbPath = resolve(process.env.WEYSABI_LEDGER_DB ?? ".weysabi/ledger.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    return SqliteUsageLedger.create(dbPath);
  }
  return new InMemoryUsageLedger();
}

export async function createServer(
  weysabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
  stop: () => void;
}> {
  const apiKey = options.apiKey ?? process.env.WEYSABI_API_KEY;
  const adminApiKey = options.adminApiKey ?? process.env.WEYSABI_ADMIN_API_KEY;
  const apiKeys = options.apiKeys;
  const port = options.port ?? envInteger("WEYSABI_PORT", 3000);
  const hostname = options.hostname ?? process.env.WEYSABI_HOST ?? "0.0.0.0";
  const corsOrigins =
    options.corsOrigins ??
    (process.env.WEYSABI_CORS_ORIGINS
      ? process.env.WEYSABI_CORS_ORIGINS.split(",").map((s) => s.trim())
      : ["*"]);
  const rateLimitRpm = options.rateLimitRpm ?? envInteger("WEYSABI_RATE_LIMIT_RPM", 300);
  const idempotencyTtl = options.idempotencyTtl ?? envInteger("WEYSABI_IDEMPOTENCY_TTL", 86400);
  const maxBodyBytes = options.maxBodyBytes ?? envInteger("WEYSABI_MAX_BODY_BYTES", 1024 * 1024);
  const trustedProxies =
    options.trustedProxies ??
    (process.env.WEYSABI_TRUSTED_PROXIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const remoteAddresses = new WeakMap<Request, string>();

  const ctrlStore = resolveControlPlaneStore(options);
  const [quotaStore, usageLedger] = await Promise.all([
    resolveQuotaStore(options),
    resolveUsageLedger(options),
  ]);

  const databaseUrl = options.databaseUrl ?? process.env.WEYSABI_DATABASE_URL;
  let authHandler: ((request: Request) => Response | Promise<Response>) | undefined;
  if (options.storage === "postgres" && databaseUrl) {
    try {
      const { createAuth } = await import("./auth");
      const auth = await createAuth(
        databaseUrl,
        process.env.WEYSABI_AUTH_URL ?? `http://localhost:${port}`,
        process.env.WEYSABI_AUTH_SECRET ?? crypto.randomUUID()
      );
      authHandler = (request: Request) => auth.handler(request);
    } catch (error) {
      log.warn("better-auth initialization failed — auth endpoints disabled", { error });
    }
  }

  const router = await createRouter(weysabi, {
    port,
    apiKey,
    adminApiKey,
    apiKeys,
    corsOrigins,
    rateLimitRpm,
    providers: options.providers,
    modelAliases: options.modelAliases,
    quotaConfig: options.quotaConfig,
    quotaStore,
    usageLedger,
    idempotencyTtl,
    maxBodyBytes,
    trustedProxies,
    rateLimitStore: options.rateLimitStore,
    idempotencyStore: options.idempotencyStore,
    controlPlaneStore: ctrlStore,
    ragConfig: options.ragConfig,
    getRemoteAddress: (request) => remoteAddresses.get(request),
    authHandler,
  });

  const wsHandler = createWsHandler({
    weysabi,
    modelAliases: buildModelAliases(options.modelAliases),
    quotaConfig: options.quotaConfig,
    quotaStore,
    usageLedger,
  });

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req, server) {
      const address = server.requestIP(req)?.address;
      if (address) remoteAddresses.set(req, address);

      const url = new URL(req.url);
      if (url.pathname === "/v1/ws") {
        const apiKeyParam = url.searchParams.get("apiKey");
        const keyFingerprint = apiKeyParam ? await fingerprintApiKey(apiKeyParam) : undefined;
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const success = server.upgrade(req, {
            data: { keyFingerprint },
          } as never);
          if (success) return;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return wsHandler.handleHttp(req);
      }

      return router.fetch(req);
    },
    websocket: {
      async message(ws, message) {
        await wsHandler.handleMessage(ws as unknown as WebSocket, message as string | Buffer);
      },
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
      {
        const qs = quotaStore as { close?: () => void };
        if (qs && typeof qs.close === "function") qs.close();
      }
      {
        const ul = usageLedger as { close?: () => void };
        if (ul && typeof ul.close === "function") ul.close();
      }
      {
        const cs = ctrlStore as { close?: () => void };
        if (cs && typeof cs.close === "function") cs.close();
      }
      if (options.closeSabiOnStop !== false) {
        weysabi.close?.();
      }
    },
  };
}

export type { ApiKeyEntry, IdempotencyStore, RateLimitStore } from "./middleware";
export { buildModelAliases, getAliasesList, resolveAlias } from "./aliases";
export type { ModelAlias, ModelAliasMap } from "./aliases";
export {
  fingerprintApiKey,
  fingerprintRequestApiKey,
  InMemoryTokenQuotaStore,
  SqliteTokenQuotaStore,
} from "./quota";
export type {
  QuotaReservation,
  QuotaReservationResult,
  TokenQuotaConfig,
  TokenQuotaStore,
} from "./quota";
export { InMemoryUsageLedger, SqliteUsageLedger } from "./ledger";
export type { UsageLedger, UsageRecord } from "./ledger";
export {
  RedisIdempotencyStore,
  RedisRateLimitStore,
  fromIORedis,
} from "@joinremba/gate/stores/redis";
export type { RedisClient } from "@joinremba/gate/stores/redis";
export { translateRequest, translateResponse, translateStreamChunk } from "./translate";
export {
  ApiKeyQuerySchema,
  AppendMessageInputSchema,
  ConversationQuerySchema,
  CreateApiKeyInputSchema,
  CreateConversationInputSchema,
  CreateDocumentInputSchema,
  CreateProjectInputSchema,
  CreatePromptInputSchema,
  CreatePromptVersionInputSchema,
  CreateRunInputSchema,
  createControlPlaneAuth,
  createConversationService,
  createProjectService,
  createPromptService,
  createPostgresControlPlaneStore,
  createSqliteControlPlaneStore,
  ControlConflictError,
  ControlError,
  ControlResourceNotFoundError,
  DocumentQuerySchema,
  MessageQuerySchema,
  PageOptionsSchema,
  ProjectNotFoundError,
  ProjectSettingsSchema,
  ProjectSlugConflictError,
  PromptMessageSchema,
  PromptVersionSchema,
  RunQuerySchema,
  RunStatsQuerySchema,
  SendConversationMessageInputSchema,
  UpdateApiKeyInputSchema,
  UpdateConversationInputSchema,
  UpdateMessageInputSchema,
  UpdateProjectInputSchema,
  UpdatePromptInputSchema,
  UpdateRunInputSchema,
  assembleConversationContext,
  registerControlRoutes,
} from "./control";
export type {
  ApiKeyQuery,
  ApiKeyStore,
  AppendMessageInput,
  CleanupOptions,
  CleanupResult,
  ControlPlaneStore,
  ContextAssemblyInput,
  Conversation,
  ConversationEvent,
  ConversationMessage,
  ConversationQuery,
  ConversationStatus,
  ConversationStore,
  ConversationUsage,
  CreateApiKeyInput,
  CreateConversationInput,
  CreateDocumentInput,
  CreatedProjectApiKey,
  CreateProjectInput,
  CreatePromptInput,
  CreatePromptVersionInput,
  CreateRunInput,
  DocumentQuery,
  DocumentStore,
  ManagedDocument,
  ManagedPrompt,
  MessageQuery,
  Page,
  PageOptions,
  Project,
  ProjectApiKey,
  ProjectScope,
  ProjectSettings,
  ProjectStore,
  PromptStore,
  PromptVersion,
  Run,
  RunAttempt,
  RunQuery,
  RunStats,
  RunStatsQuery,
  RunStatus,
  RunStore,
  RegisterControlRoutesOptions,
  SendConversationMessageInput,
  SendConversationMessageResult,
  UpdateApiKeyInput,
  UpdateConversationInput,
  UpdateMessageInput,
  UpdateProjectInput,
  UpdatePromptInput,
  UpdateRunInput,
} from "./control";
