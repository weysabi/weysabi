import type { Weysabi } from "@weysabi/sabi";
import { createRouter, type ServerOptions } from "./routes";
import { validateOrExit } from "./config";

export type { ServerOptions };

export async function createServer(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  stop: () => void;
}> {
  const config = validateOrExit();
  if (!config) {
    throw new Error("Server config validation failed");
  }

  const apiKey = options.apiKey ?? process.env.SABI_API_KEY;
  const apiKeys = options.apiKeys;
  const port = options.port ?? config.get<number>("SABI_PORT");
  const corsOrigins =
    options.corsOrigins ??
    (process.env.SABI_CORS_ORIGINS
      ? process.env.SABI_CORS_ORIGINS.split(",").map((s) => s.trim())
      : config
          .get<string>("SABI_CORS_ORIGINS")
          .split(",")
          .map((s) => s.trim()));
  const rateLimitRpm = options.rateLimitRpm ?? config.get<number>("SABI_RATE_LIMIT_RPM");
  const idempotencyTtl = options.idempotencyTtl ?? config.get<number>("SABI_IDEMPOTENCY_TTL");

  const router = await createRouter(sabi, {
    port,
    apiKey,
    apiKeys,
    corsOrigins,
    rateLimitRpm,
    providers: options.providers,
    idempotencyTtl,
  });

  const server = Bun.serve({
    port,
    fetch: router.fetch as (req: Request) => Response | Promise<Response>,
  });

  return {
    fetch: router.fetch as (req: Request) => Response | Promise<Response>,
    port: server.port as number,
    stop: () => server.stop(),
  };
}

export { translateRequest, translateResponse, translateStreamChunk } from "./translate";
