import Link from "next/link";

export default function ServerPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground mb-8 block">
        &larr; Back to docs
      </Link>
      <h1 className="text-3xl font-bold mb-6">Running the Server</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Quick Start</h2>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto mb-4">
          <code>{`bun add @weysabi/server
SABI_GROQ_API_KEY=gsk_... bunx weysabi-server`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Configuration</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The server reads configuration from environment variables:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4">Variable</th>
                <th className="text-left py-2 pr-4">Default</th>
                <th className="text-left py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["SABI_PORT", "3000", "HTTP listen port"],
                ["SABI_HOST", "0.0.0.0", "Listen address"],
                ["SABI_API_KEY", "—", "Admin API key"],
                ["SABI_ADMIN_API_KEY", "—", "Dedicated admin endpoint key"],
                ["SABI_RATE_LIMIT_RPM", "300", "Rate limit per minute"],
                ["SABI_CORS_ORIGINS", "*", "Allowed CORS origins"],
                ["SABI_MODEL_ALIASES", "—", "Model alias mappings"],
              ].map(([name, def, desc]) => (
                <tr key={name} className="border-b border-border">
                  <td className="py-2 pr-4 font-mono text-xs">{name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{def}</td>
                  <td className="py-2 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">API Endpoints</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <code className="text-xs">POST /v1/chat/completions</code> — OpenAI-compatible chat
          </li>
          <li>
            <code className="text-xs">GET /v1/models</code> — List available models
          </li>
          <li>
            <code className="text-xs">GET /health</code> — Health check
          </li>
          <li>
            <code className="text-xs">GET /v1/admin/stats</code> — Protected usage statistics
          </li>
          <li>
            <code className="text-xs">GET /v1/admin/usage</code> — Protected usage records
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Programmatic Usage</h2>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto">
          <code>{`import { createWeysabi } from "@weysabi/sabi";
import { createServer } from "@weysabi/server";

const sabi = createWeysabi({
  groq: { apiKey: process.env.GROQ_API_KEY },
});

const server = await createServer(sabi, {
  port: 3000,
  apiKey: "sk-secret",
  adminApiKey: "sk-admin-secret",
});

// server.stop() to shut down`}</code>
        </pre>
      </section>
    </article>
  );
}
