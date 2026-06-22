import type { Sabi } from "../index";
import { translateRequest, translateResponse, translateStreamChunk } from "./translate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoApp = any;

function sseErrorEvent(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "sabi_error" } })}\n\n`;
}

export async function createRouter(
  sabi: Sabi
): Promise<{ fetch: (req: Request) => Response | Promise<Response> }> {
  let Hono: new () => HonoApp;
  try {
    // @ts-expect-error - hono may not be installed; error handled at runtime
    Hono = (await import("hono")).Hono;
  } catch {
    throw new Error("Hono is required for Sabi Server. Install it: bun add hono");
  }
  const app = new Hono();

  app.get("/v1/models", (c: HonoApp) => {
    return c.json({
      object: "list",
      data: [
        {
          id: "sabi-proxy",
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "weysabi",
        },
      ],
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
