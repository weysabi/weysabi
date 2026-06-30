import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve, dirname } from "path";
import type { ProviderConfig } from "../types";
import { providerRegistry, envDiscoverableProviders } from "../providers/registry";

export interface WeysabiConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel?: string;
  promptsDir?: string;
}

const CONFIG_FILENAME = "weysabi.json";

function findConfigPath(): string | null {
  const cwd = process.cwd();
  const local = resolve(cwd, CONFIG_FILENAME);
  if (existsSync(local)) return local;

  const envPath = process.env.WEYSABI_CONFIG_PATH;
  if (envPath && existsSync(resolve(envPath))) return resolve(envPath);

  const global = resolve(homedir(), ".config", "weysabi", "config.json");
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

  const envProviders = envDiscoverableProviders;
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
  return providerRegistry[name.toLowerCase()]?.label ?? name;
}

import { errorMessage } from "../index";

export function resolveProvidersWithGuard(options: { noConfig?: boolean }): {
  providers: Record<string, ProviderConfig>;
  defaultModel?: string;
} {
  let providers: Record<string, ProviderConfig> = {};
  let defaultModel: string | undefined;

  if (!options.noConfig) {
    const loaded = loadConfig();
    if (loaded) {
      providers = resolveProviders(loaded.config.providers);
      defaultModel = loaded.config.defaultModel;
    }
  }

  if (Object.keys(providers).length === 0 && !options.noConfig) {
    providers = resolveProviders();
  }

  if (Object.keys(providers).length === 0) {
    console.error("No providers configured. Set API_KEY env vars or run `weysabi init`.");
    process.exit(1);
  }

  return { providers, defaultModel };
}

export async function testProvider(
  name: string,
  config: ProviderConfig,
  model?: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const testModel = model ?? providerRegistry[name.toLowerCase()]?.defaultModel;

  if (!testModel) {
    return { ok: false, latencyMs: 0, error: `No default model for ${name}` };
  }

  const start = performance.now();
  try {
    const { createWeysabi } = await import("../index");
    const weysabi = createWeysabi(
      { [name]: config },
      { retry: { maxRetries: 0 }, telemetry: { onAttempt: () => {} } }
    );

    await weysabi.complete({
      model: testModel,
      messages: [{ role: "user", content: "respond with the word ok" }],
      maxTokens: 10,
    });

    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: errorMessage(err),
    };
  }
}
