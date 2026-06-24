import type { Weysabi } from "@weysabi/client";
import { createRouter, type ServerOptions } from "./routes";

export type { ServerOptions };

export async function createServer(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  stop: () => void;
}> {
  const apiKey = options.apiKey ?? process.env.SABI_API_KEY;
  const port = options.port ?? (Number(process.env.SABI_PORT) || 3000);
  const corsOrigins =
    options.corsOrigins ??
    (process.env.SABI_CORS_ORIGINS
      ? process.env.SABI_CORS_ORIGINS.split(",").map((s) => s.trim())
      : undefined);
  const rateLimitRpm = options.rateLimitRpm ?? (Number(process.env.SABI_RATE_LIMIT_RPM) || 300);

  const router = await createRouter(sabi, {
    port,
    apiKey,
    corsOrigins,
    rateLimitRpm,
    providers: options.providers,
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
