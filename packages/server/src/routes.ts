import type { Weysabi } from "@weysabi/client";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";
import { createAuth, createRateLimiter } from "./middleware";

export interface ServerOptions {
  port?: number;
  apiKey?: string;
  corsOrigins?: string[];
  rateLimitRpm?: number;
  providers?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoApp = any;

function sseErrorEvent(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "sabi_error" } })}\n\n`;
}

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
        allowHeaders: ["Content-Type", "Authorization"],
        exposeHeaders: ["Content-Length"],
        maxAge: 86400,
      })
    );
  } catch {
    // cors() is a no-op if Hono is too old
  }

  if (options.apiKey) {
    app.use("/*", createAuth(options.apiKey));
  }

  const rpm = options.rateLimitRpm ?? 300;
  app.use("/*", createRateLimiter(rpm));

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

    return c.json({
      object: "list",
      data,
    });
  });

  app.get("/health", (c: HonoApp) => {
    return c.json({ status: "ok", timestamp: Date.now() });
  });

  app.post("/v1/chat/completions", async (c: HonoApp) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const stream = body.stream === true;
    const request = translateRequest(body);

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
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
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

    try {
      const response = await sabi.complete(request);
      const translated = translateResponse(response, request.model as string);
      return c.json(translated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            message,
            type: "sabi_error",
          },
        },
        500
      );
    }
  });

  return { fetch: app.fetch as (req: Request) => Response | Promise<Response> };
}
