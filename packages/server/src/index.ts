import type { Weysabi } from "@weysabi/client";
import { createRouter } from "./routes";

export interface ServerOptions {
  port?: number;
}

export async function createServer(
  sabi: Weysabi,
  options: ServerOptions = {}
): Promise<{
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  stop: () => void;
}> {
  const port = options.port ?? (Number(process.env.SABI_PORT) || 3000);
  const router = await createRouter(sabi);

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
