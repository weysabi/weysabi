import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const TEMPLATES = ["server", "nextjs", "tanstack", "agent"] as const;

export type CreateTemplate = (typeof TEMPLATES)[number];

export interface CreateCommandOptions {
  template?: string;
  install?: boolean;
}

export interface CreateProjectOptions {
  cwd?: string;
  template?: CreateTemplate;
  install?: boolean;
}

interface TemplateFile {
  path: string;
  content: string;
}

interface ProjectTemplate {
  files: TemplateFile[];
  nextSteps: string[];
}

function isCreateTemplate(value: string): value is CreateTemplate {
  return TEMPLATES.includes(value as CreateTemplate);
}

export function validateProjectName(name: string): string | null {
  if (!name.trim()) return "Project name is required.";
  if (name === "." || name === "..") return "Project name cannot be . or ...";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name)) {
    return "Use letters, numbers, dots, underscores, or hyphens only.";
  }
  return null;
}

function packageNameFromProjectName(projectName: string): string {
  return projectName.toLowerCase().replaceAll("_", "-");
}

function serverTemplate(projectName: string): ProjectTemplate {
  const packageName = packageNameFromProjectName(projectName);

  return {
    files: [
      {
        path: "package.json",
        content: `${JSON.stringify(
          {
            name: packageName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "bun --watch src/index.ts",
              start: "bun src/index.ts",
              typecheck: "bunx tsc --noEmit",
            },
            dependencies: {
              "@weysabi/sabi": "^0.9.0",
              "@weysabi/server": "^0.9.0",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2
        )}\n`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
`,
      },
      {
        path: "src/index.ts",
        content: `import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createWeysabi } from "@weysabi/sabi";
import { createServer, createSqliteControlPlaneStore } from "@weysabi/server";

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  throw new Error("OPENAI_API_KEY is required. Copy .env.example to .env and set it.");
}

const controlDbPath = process.env.SABI_CONTROL_DB ?? ".sabi/control.db";
mkdirSync(dirname(controlDbPath), { recursive: true });

const sabi = createWeysabi(
  {
    openai: {
      apiKey: openaiApiKey,
    },
  },
  {
    defaultModel: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini",
  }
);

const server = await createServer(sabi, {
  apiKey: process.env.SABI_API_KEY,
  adminApiKey: process.env.SABI_ADMIN_API_KEY,
  controlPlaneStore: createSqliteControlPlaneStore(controlDbPath),
});

console.log(\`Sabi server listening on http://\${server.hostname}:\${server.port}\`);
console.log("OpenAI-compatible API: /v1/chat/completions");
console.log("Admin/control-plane API: /v1/projects");
`,
      },
      {
        path: ".env.example",
        content: `# Provider key used by the generated Sabi server.
OPENAI_API_KEY=

# Optional client-facing API key for OpenAI-compatible routes.
SABI_API_KEY=dev-client-key

# Required for admin/control-plane routes such as /v1/projects.
SABI_ADMIN_API_KEY=dev-admin-key

SABI_DEFAULT_MODEL=openai/gpt-4o-mini
SABI_CONTROL_DB=.sabi/control.db
SABI_PORT=3000
SABI_HOST=0.0.0.0
`,
      },
      {
        path: ".gitignore",
        content: `node_modules
.env
.sabi
dist
`,
      },
      {
        path: "README.md",
        content: `# ${projectName}

Sabi server starter.

## Setup

\`\`\`bash
cp .env.example .env
bun install
bun run dev
\`\`\`

Then call:

- OpenAI-compatible chat: \`POST /v1/chat/completions\`
- Control plane: \`/v1/projects\` with \`Authorization: Bearer $SABI_ADMIN_API_KEY\`

Provider secrets and admin keys must stay server-side.
`,
      },
    ],
    nextSteps: [
      `cd ${projectName}`,
      "cp .env.example .env",
      "set OPENAI_API_KEY in .env",
      "bun install",
      "bun run dev",
    ],
  };
}

function nextjsTemplate(projectName: string): ProjectTemplate {
  const packageName = packageNameFromProjectName(projectName);

  return {
    files: [
      {
        path: "package.json",
        content: `${JSON.stringify(
          {
            name: packageName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
              typecheck: "tsc --noEmit",
            },
            dependencies: {
              "@weysabi/sabi": "^0.9.0",
              next: "^15",
              react: "^19",
              "react-dom": "^19",
            },
            devDependencies: {
              "@types/node": "^22",
              "@types/react": "^19",
              "@types/react-dom": "^19",
              typescript: "^5",
            },
          },
          null,
          2
        )}\n`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
      },
      {
        path: "next.config.ts",
        content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
      },
      {
        path: "app/layout.tsx",
        content: `import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "Sabi AI starter",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: "app/page.tsx",
        content: `"use client";

import { FormEvent, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Ask me something. Sabi is wired on the server." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { message: ChatMessage };
      setMessages([...nextMessages, data.message]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Request failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="shell">
        <p className="eyebrow">Sabi starter</p>
        <h1>Provider-agnostic AI, wired server-side.</h1>
        <p className="lede">
          This page calls <code>/api/chat</code>. Provider keys stay in environment variables.
        </p>

        <div className="chat">
          {messages.map((message, index) => (
            <div className={\`message \${message.role}\`} key={\`\${message.role}-\${index}\`}>
              <span>{message.role}</span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>

        <form onSubmit={sendMessage}>
          <input
            aria-label="Message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Sabi..."
          />
          <button disabled={loading || input.trim().length === 0} type="submit">
            {loading ? "Sending..." : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}
`,
      },
      {
        path: "app/api/chat/route.ts",
        content: `import { createWeysabi } from "@weysabi/sabi";

type ChatMessage = {
  role: string;
  content: string;
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}

export async function POST(request: Request) {
  const body = (await request.json()) as { messages?: unknown };
  const messages = Array.isArray(body.messages) ? body.messages.filter(isChatMessage) : [];

  if (messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  const sabi = createWeysabi(
    {
      openai: {
        apiKey: openaiApiKey,
      },
    },
    {
      defaultModel: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini",
    }
  );

  const response = await sabi.complete({
    model: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini",
    messages,
  });

  return Response.json({
    message: {
      role: "assistant",
      content: response.content,
    },
    usage: response.usage,
  });
}
`,
      },
      {
        path: "app/styles.css",
        content: `:root {
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #07070a;
  color: #f6f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

main {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.shell {
  width: min(760px, 100%);
}

.eyebrow {
  color: #9ca3af;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 12px;
}

h1 {
  font-size: clamp(36px, 8vw, 72px);
  line-height: 0.95;
  margin: 0 0 16px;
}

.lede {
  color: #cbd5e1;
  font-size: 18px;
}

.chat {
  display: grid;
  gap: 12px;
  margin: 32px 0 16px;
}

.message {
  border: 1px solid #27272a;
  border-radius: 16px;
  padding: 16px;
  background: #111116;
}

.message span {
  display: block;
  color: #9ca3af;
  font-size: 12px;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.message.user {
  background: #172033;
}

form {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  border: 1px solid #27272a;
  border-radius: 999px;
  background: #111116;
  color: inherit;
  padding: 14px 18px;
}

button {
  border: 0;
  border-radius: 999px;
  padding: 14px 18px;
  background: #f6f7fb;
  color: #07070a;
  font-weight: 700;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
`,
      },
      {
        path: ".env.example",
        content: `# Server-only provider key. Never expose this in browser code.
OPENAI_API_KEY=

SABI_DEFAULT_MODEL=openai/gpt-4o-mini
`,
      },
      {
        path: ".gitignore",
        content: `node_modules
.next
.env
dist
`,
      },
      {
        path: "README.md",
        content: `# ${projectName}

Sabi Next.js starter.

## Setup

\`\`\`bash
cp .env.example .env
bun install
bun run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000).

The browser calls \`/api/chat\`; Sabi and provider credentials run server-side only.
`,
      },
    ],
    nextSteps: [
      `cd ${projectName}`,
      "cp .env.example .env",
      "set OPENAI_API_KEY in .env",
      "bun install",
      "bun run dev",
    ],
  };
}

function tanstackTemplate(projectName: string): ProjectTemplate {
  const packageName = packageNameFromProjectName(projectName);

  return {
    files: [
      {
        path: "package.json",
        content: `${JSON.stringify(
          {
            name: packageName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "bun run --hot src/api/server.ts & bunx --bun vite",
              build: "bun run src/api/server.ts & vite build",
              typecheck: "bunx tsc --noEmit",
            },
            dependencies: {
              "@tanstack/react-router": "^1",
              "@weysabi/sabi": "^0.9.0",
              react: "^19",
              "react-dom": "^19",
            },
            devDependencies: {
              "@types/bun": "latest",
              "@types/react": "^19",
              "@types/react-dom": "^19",
              "@vitejs/plugin-react": "^4",
              typescript: "^5",
              vite: "^6",
            },
          },
          null,
          2
        )}\n`,
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              lib: ["DOM", "DOM.Iterable", "ESNext"],
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "bundler",
              jsx: "preserve",
              strict: true,
              skipLibCheck: true,
              noEmit: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              resolveJsonModule: true,
              isolatedModules: true,
              types: ["bun"],
            },
            include: ["src"],
          },
          null,
          2
        ) + "\n",
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:3001" },
  },
});
`,
      },
      {
        path: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
`,
      },
      {
        path: "src/routeTree.gen.ts",
        content: `import { rootRoute } from "./routes/__root";
import { Route } from "@tanstack/react-router";

const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  lazy: () => import("./routes/index").then((d) => d.route),
});

export const routeTree = rootRoute.addChildren([indexRoute]);
`,
      },
      {
        path: "src/routes/__root.tsx",
        content: `import { Outlet, createRootRoute } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${projectName}</title>
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  ),
});
`,
      },
      {
        path: "src/routes/index.tsx",
        content: `import { FormEvent, useState } from "react";
import { Route } from "@tanstack/react-router";
import { rootRoute } from "./__root";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function IndexPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Ask me something. Sabi is wired on the server." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { message: ChatMessage };
      setMessages([...nextMessages, data.message]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        { role: "assistant", content: error instanceof Error ? error.message : "Request failed" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Sabi + TanStack</h1>
      <p>This page calls <code>/api/chat</code>. Provider keys stay in environment variables.</p>
      <div className="chat">
        {messages.map((message, index) => (
          <div className={\`message \${message.role}\`} key={\`\${message.role}-\${index}\`}>
            <span>{message.role}</span>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage}>
        <input
          aria-label="Message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Sabi..."
        />
        <button disabled={loading || input.trim().length === 0} type="submit">
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
    </main>
  );
}

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});
`,
      },
      {
        path: "src/api/server.ts",
        content: `import { createWeysabi } from "@weysabi/sabi";

const PORT = 3001;

type ChatMessage = { role: string; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}

const sabi = createWeysabi(
  { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  { defaultModel: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini" }
);

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = (await request.json()) as { messages?: unknown };
      const messages = Array.isArray(body.messages) ? body.messages.filter(isChatMessage) : [];
      if (messages.length === 0) {
        return Response.json({ error: "messages is required" }, { status: 400 });
      }

      const response = await sabi.complete({ model: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini", messages });
      return Response.json({ message: { role: "assistant", content: response.content }, usage: response.usage });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(\`API server on http://localhost:\${PORT}\`);
`,
      },
      {
        path: ".env.example",
        content: `# Server-only provider key. Never expose this in browser code.
OPENAI_API_KEY=

SABI_DEFAULT_MODEL=openai/gpt-4o-mini
`,
      },
      {
        path: ".gitignore",
        content: `node_modules
dist
.env
`,
      },
      {
        path: "README.md",
        content: `# ${projectName}

Sabi TanStack starter.

## Setup

\`\`\`bash
cp .env.example .env
bun install
bun run dev
\`\`\`

Opens Vite dev server on [http://localhost:5173](http://localhost:5173).
The browser calls \`/api/chat\`; Sabi and provider credentials run server-side only.
`,
      },
    ],
    nextSteps: [
      `cd ${projectName}`,
      "cp .env.example .env",
      "set OPENAI_API_KEY in .env",
      "bun install",
      "bun run dev",
    ],
  };
}

function agentTemplate(projectName: string): ProjectTemplate {
  const packageName = packageNameFromProjectName(projectName);

  return {
    files: [
      {
        path: "package.json",
        content: `${JSON.stringify(
          {
            name: packageName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "bun run src/index.ts",
              start: "bun run src/index.ts",
              typecheck: "bunx tsc --noEmit",
            },
            dependencies: {
              "@weysabi/sabi": "^0.9.0",
              "@weysabi/server": "^0.9.0",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2
        )}\n`,
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              lib: ["ESNext"],
              target: "ESNext",
              module: "Preserve",
              moduleResolution: "bundler",
              strict: true,
              skipLibCheck: true,
              types: ["bun"],
            },
            include: ["src"],
          },
          null,
          2
        ) + "\n",
      },
      {
        path: "src/index.ts",
        content: `import { createWeysabi } from "@weysabi/sabi";
import { createServer, createSqliteControlPlaneStore } from "@weysabi/server";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required. See .env.example.");

const sabi = createWeysabi(
  { openai: { apiKey } },
  { defaultModel: process.env.SABI_DEFAULT_MODEL ?? "openai/gpt-4o-mini" }
);

const server = await createServer(sabi, {
  apiKey: process.env.SABI_API_KEY,
  adminApiKey: process.env.SABI_ADMIN_API_KEY,
  controlPlaneStore: createSqliteControlPlaneStore(".sabi/control.db"),
});

// Seed a project and prompt version via control plane
const adminHeaders = { Authorization: \`Bearer \${process.env.SABI_ADMIN_API_KEY}\`, "content-type": "application/json" };
const adminOrigin = \`http://\${server.hostname}:\${server.port}\`;

const projectRes = await fetch(\`\${adminOrigin}/v1/projects\`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({ name: "default" }),
});
const project = (await projectRes.json()) as { id: string };

await fetch(\`\${adminOrigin}/v1/projects/\${project.id}/prompts\`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({ name: "greeting", content: "Hello, {name}!" }),
});

console.log(\`Agent server at http://\${server.hostname}:\${server.port}\`);
console.log(\`Project ID: \${project.id}\`);
`,
      },
      {
        path: ".env.example",
        content: `OPENAI_API_KEY=
SABI_API_KEY=dev-client-key
SABI_ADMIN_API_KEY=dev-admin-key
SABI_DEFAULT_MODEL=openai/gpt-4o-mini
`,
      },
      {
        path: ".gitignore",
        content: `node_modules
.env
.sabi
dist
`,
      },
      {
        path: "README.md",
        content: `# ${projectName}

Sabi agent starter with control-plane seeding.

## Setup

\`\`\`bash
cp .env.example .env
bun install
bun run dev
\`\`\`

Starts a server and seeds a project + prompt version automatically.
`,
      },
    ],
    nextSteps: [
      `cd ${projectName}`,
      "cp .env.example .env",
      "set OPENAI_API_KEY in .env",
      "bun install",
      "bun run dev",
    ],
  };
}

function getProjectTemplate(template: CreateTemplate, projectName: string): ProjectTemplate {
  if (template === "server") return serverTemplate(projectName);
  if (template === "nextjs") return nextjsTemplate(projectName);
  if (template === "tanstack") return tanstackTemplate(projectName);
  return agentTemplate(projectName);
}

function writeTemplateFiles(targetDir: string, files: TemplateFile[]): void {
  for (const file of files) {
    const target = resolve(targetDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf-8");
  }
}

async function installDependencies(targetDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "install"], {
    cwd: targetDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`bun install failed with exit code ${exitCode}`);
  }
}

export async function createSabiProject(
  projectName: string,
  options: CreateProjectOptions = {}
): Promise<ProjectTemplate> {
  const validationError = validateProjectName(projectName);
  if (validationError) throw new Error(validationError);

  const template = options.template ?? "server";
  const cwd = options.cwd ?? process.cwd();
  const targetDir = resolve(cwd, projectName);

  if (existsSync(targetDir)) {
    throw new Error(`Directory "${projectName}" already exists.`);
  }

  const projectTemplate = getProjectTemplate(template, projectName);
  mkdirSync(targetDir, { recursive: true });
  writeTemplateFiles(targetDir, projectTemplate.files);

  if (options.install !== false) {
    await installDependencies(targetDir);
  }

  return projectTemplate;
}

export async function createCommand(
  projectName: string,
  options: CreateCommandOptions
): Promise<void> {
  const rawTemplate = options.template ?? "server";
  if (!isCreateTemplate(rawTemplate)) {
    throw new Error(`Unknown template: ${rawTemplate}. Use one of: ${TEMPLATES.join(", ")}.`);
  }

  const result = await createSabiProject(projectName, {
    template: rawTemplate,
    install: options.install,
  });

  console.log(`Created Sabi project: ${projectName}`);
  console.log("Next steps:");
  for (const step of result.nextSteps) {
    console.log(`  ${step}`);
  }
}
