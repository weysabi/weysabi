import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve, dirname } from "path";
import type { ProviderConfig } from "../types";

export interface WeysabiConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel?: string;
  promptsDir?: string;
}

const CONFIG_FILENAME = "sabi.json";

function findConfigPath(): string | null {
  const cwd = process.cwd();
  const local = resolve(cwd, CONFIG_FILENAME);
  if (existsSync(local)) return local;

  const envPath = process.env.SABI_CONFIG_PATH;
  if (envPath && existsSync(resolve(envPath))) return resolve(envPath);

  const global = resolve(homedir(), ".config", "sabi", "config.json");
  if (existsSync(global)) return global;

  return null;
}

export function loadConfig(): { config: WeysabiConfig; path: string } | null {
  const path = findConfigPath();
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const config = JSON.parse(raw) as WeysabiConfig;
    return { config, path };
  } catch {
    return null;
  }
}

export function saveConfig(config: WeysabiConfig, path?: string): string {
  const target = path ?? resolve(process.cwd(), CONFIG_FILENAME);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n");
  return target;
}

export function resolveProviders(
  configured?: Record<string, ProviderConfig>
): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};

  if (configured) {
    for (const [name, cfg] of Object.entries(configured)) {
      providers[name] = {
        ...cfg,
        apiKey: cfg.apiKey || process.env[`${name.toUpperCase()}_API_KEY`] || "",
      };
    }
  }

  const envProviders = [
    "groq",
    "openai",
    "anthropic",
    "google",
    "mistral",
    "nvidia",
    "deepseek",
    "together",
    "openrouter",
  ];
  for (const name of envProviders) {
    if (providers[name]) continue;
    const key = process.env[`${name.toUpperCase()}_API_KEY`];
    if (key) {
      providers[name] = { apiKey: key };
    }
  }

  return providers;
}

export function printTable(rows: string[][]): void {
  if (rows.length === 0) return;
  const colWidths = rows[0]!.map((_, ci) => Math.max(...rows.map((r) => (r[ci] ?? "").length)));
  for (const row of rows) {
    const line = row.map((cell, ci) => cell.padEnd(colWidths[ci]!)).join("  ");
    console.log(line);
  }
}

export function statusIcon(ok: boolean): string {
  return ok ? "\u2713" : "\u2717";
}

export function providerLabel(name: string): string {
  const labels: Record<string, string> = {
    groq: "Groq",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini",
    mistral: "Mistral AI",
    nvidia: "NVIDIA",
    deepseek: "DeepSeek",
    together: "Together AI",
    openrouter: "OpenRouter",
    ollama: "Ollama",
  };
  return labels[name.toLowerCase()] ?? name;
}

export async function testProvider(
  name: string,
  config: ProviderConfig,
  model?: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const defaultModels: Record<string, string> = {
    groq: "groq/llama-3.1-8b-instant",
    openai: "openai/gpt-4o-mini",
    anthropic: "anthropic/claude-3-5-haiku-20241022",
    google: "google/gemini-2.0-flash",
    mistral: "mistral/mistral-small-latest",
    nvidia: "nvidia/llama-3.1-8b-instruct",
    deepseek: "deepseek/deepseek-chat",
    together: "together/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    openrouter: "openrouter/meta-llama/llama-3.1-8b-instruct",
    ollama: "ollama/llama3.2",
  };

  const testModel = model ?? defaultModels[name.toLowerCase()];

  if (!testModel) {
    return { ok: false, latencyMs: 0, error: `No default model for ${name}` };
  }

  const start = performance.now();
  try {
    const { createWeysabi } = await import("../index");
    const sabi = createWeysabi(
      { [name]: config },
      { retry: { maxRetries: 0 }, telemetry: { onAttempt: () => {} } }
    );

    await sabi.complete({
      model: testModel,
      messages: [{ role: "user", content: "respond with the word ok" }],
      maxTokens: 10,
    });

    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
