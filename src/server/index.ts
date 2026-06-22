import type { Sabi } from "../sabi";
import { createRouter } from "./routes";

export interface SabiServerOptions {
  port?: number;
}

export async function createSabiServer(
  sabi: Sabi,
  options: SabiServerOptions = {}
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
