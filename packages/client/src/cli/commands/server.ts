import { resolveProviders } from "../utils";
import type { Weysabi } from "../../weysabi";

export async function serverCommand(options: { port?: string; host?: string }): Promise<void> {
  const providers = resolveProviders();
  if (Object.keys(providers).length === 0) {
    console.error(
      "No providers configured. Set SABI_OPENAI_API_KEY (or similar) or create sabi.json."
    );
    process.exit(1);
  }

  const { createWeysabi } = await import("../../index");
  const sabi = createWeysabi(providers);

  let createServer: (sabi: Weysabi, options: { port?: number }) => Promise<{ port: number }>;
  try {
    createServer = (await import("@weysabi/server")).createServer;
  } catch {
    console.error(
      "@weysabi/server is required for sabi serve. Install it: bun add @weysabi/server"
    );
    process.exit(1);
  }

  const port = Number(options.port) || Number(process.env.SABI_PORT) || 3000;

  console.log(`Weysabi Server starting on http://localhost:${port}`);
  console.log(`Providers: ${Object.keys(providers).join(", ")}`);

  try {
    const server = (await createServer(sabi, { port })) as { port: number };
    console.log(`Weysabi Server ready — http://localhost:${server.port}`);
    console.log("Endpoints:");
    console.log(`  POST /v1/chat/completions — OpenAI-compatible chat`);
    console.log(`  GET  /v1/models           — List models`);
    console.log(`  GET  /health              — Health check`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start server: ${message}`);
    process.exit(1);
  }
}
