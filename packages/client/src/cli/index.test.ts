import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  loadConfig,
  resolveProviders,
  printTable,
  statusIcon,
  providerLabel,
  saveConfig,
} from "./utils";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";

describe("providerLabel", () => {
  it("returns display name for known providers", () => {
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("google")).toBe("Google Gemini");
    expect(providerLabel("mistral")).toBe("Mistral AI");
    expect(providerLabel("ollama")).toBe("Ollama");
  });

  it("returns original name for unknown providers", () => {
    expect(providerLabel("custom-provider")).toBe("custom-provider");
  });

  it("is case-insensitive", () => {
    expect(providerLabel("GROQ")).toBe("Groq");
    expect(providerLabel("OpenAI")).toBe("OpenAI");
  });
});

describe("statusIcon", () => {
  it("returns checkmark for true", () => {
    expect(statusIcon(true)).toBe("\u2713");
  });

  it("returns cross for false", () => {
    expect(statusIcon(false)).toBe("\u2717");
  });
});

describe("printTable", () => {
  it("does nothing for empty rows", () => {
    const logs: string[] = [];
    const spy = console.log;
    console.log = (m: string) => logs.push(m);
    printTable([]);
    expect(logs).toEqual([]);
    console.log = spy;
  });

  it("formats columns with padding", () => {
    const logs: string[] = [];
    const spy = console.log;
    console.log = (m: string) => logs.push(m);
    printTable([
      ["A", "B"],
      ["longer", "x"],
    ]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe("A       B");
    console.log = spy;
  });
});

describe("resolveProviders", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns configured providers with env key fallback", () => {
    process.env.GROQ_API_KEY = "env-groq-key";
    const result = resolveProviders({ groq: { apiKey: "" } });
    expect(result.groq).toBeDefined();
    expect(result.groq!.apiKey).toBe("env-groq-key");
  });

  it("prefers configured key over env key", () => {
    process.env.GROQ_API_KEY = "env-key";
    const result = resolveProviders({ groq: { apiKey: "cfg-key" } });
    expect(result.groq!.apiKey).toBe("cfg-key");
  });

  it("discovers providers from env vars", () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.OPENAI_API_KEY = "openai-key";
    const result = resolveProviders();
    expect(result.groq).toBeDefined();
    expect(result.openai).toBeDefined();
    expect(result.groq!.apiKey).toBe("groq-key");
  });

  it("does not overwrite configured provider with env", () => {
    process.env.GROQ_API_KEY = "env-key";
    const result = resolveProviders({ groq: { apiKey: "cfg-key" } });
    expect(result.groq!.apiKey).toBe("cfg-key");
  });

  it("scans all known provider env vars", () => {
    process.env.GROQ_API_KEY = "k1";
    process.env.OPENAI_API_KEY = "k2";
    process.env.ANTHROPIC_API_KEY = "k3";
    process.env.GOOGLE_API_KEY = "k4";
    process.env.MISTRAL_API_KEY = "k5";
    process.env.NVIDIA_API_KEY = "k6";
    process.env.DEEPSEEK_API_KEY = "k7";
    process.env.TOGETHER_API_KEY = "k8";
    process.env.OPENROUTER_API_KEY = "k9";
    const result = resolveProviders();
    expect(Object.keys(result).sort()).toEqual([
      "anthropic",
      "deepseek",
      "google",
      "groq",
      "mistral",
      "nvidia",
      "openai",
      "openrouter",
      "together",
    ]);
  });

  it("returns empty object when nothing configured", () => {
    const result = resolveProviders();
    expect(result).toEqual({});
  });
});

describe("loadConfig / saveConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("sabi-test-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads config", () => {
    const configPath = resolve(tmpDir, "sabi.json");
    const config = {
      providers: { groq: { apiKey: "test-key" } },
      defaultModel: "groq/llama-4-scout",
      promptsDir: "./prompts",
    };
    const saved = saveConfig(config, configPath);
    expect(saved).toBe(configPath);
  });

  it("returns null when no config exists", () => {
    const result = loadConfig();
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const configPath = resolve(tmpDir, "sabi.json");
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    writeFileSync(configPath, "not json", "utf-8");
    const result = loadConfig();
    expect(result).toBeNull();
    process.cwd = origCwd;
  });
});

describe("doctor command", () => {
  let originalEnv: typeof process.env;
  let logs: string[];

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    logs = [];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reports no API keys when none configured", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const origExit = process.exit;
    const origLog = console.log;
    const origError = console.error;
    const origStdoutWrite = process.stdout.write;
    process.exit = (() => {}) as unknown as typeof process.exit;
    console.log = (m: string) => logs.push(m);
    console.error = (m: string) => logs.push(m);
    process.stdout.write = (() => true) as unknown as typeof process.stdout.write;

    const { doctorCommand } = await import("./commands/doctor");
    await doctorCommand();

    const allOutput = logs.join(" ");
    expect(allOutput).toInclude("API Keys");
    expect(allOutput).toInclude("Runtime");

    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origStdoutWrite;
  });
});

describe("complete command", () => {
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv, GROQ_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("exits with error when no model specified and no config model", async () => {
    const origExit = process.exit;
    const origError = console.error;
    const errors: string[] = [];
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
    }) as typeof process.exit;
    console.error = (m: string) => errors.push(m);

    const { completeCommand } = await import("./commands/complete");
    await completeCommand("hello", {});

    expect(errors.some((e) => e.includes("model"))).toBeTrue();
    expect(exitCode).toBe(1);

    process.exit = origExit;
    console.error = origError;
  });

  it("exits with error when no providers configured and no env keys", async () => {
    process.env = {};
    const origExit = process.exit;
    const origError = console.error;
    const errors: string[] = [];
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
    }) as typeof process.exit;
    console.error = (m: string) => errors.push(m);

    const { completeCommand } = await import("./commands/complete");
    await completeCommand("hello", { noConfig: true });

    expect(errors.some((e) => e.includes("providers") || e.includes("API_KEY"))).toBeTrue();
    expect(exitCode).toBe(1);

    process.exit = origExit;
    console.error = origError;
  });
});

describe("config validate command", () => {
  let originalEnv: typeof process.env;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv, GROQ_API_KEY: "test-key" };
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok", role: "assistant" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            model: "llama-3.1-8b-instant",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("passes with valid env provider", async () => {
    const origExit = process.exit;
    const origLog = console.log;
    const origStdoutWrite = process.stdout.write;
    const logs: string[] = [];
    process.exit = (() => {}) as unknown as typeof process.exit;
    console.log = (m: string) => logs.push(m);
    process.stdout.write = (() => true) as unknown as typeof process.stdout.write;

    const { configValidateCommand } = await import("./commands/config");
    await configValidateCommand();

    const allOutput = logs.join(" ");
    expect(allOutput).toInclude("OK");

    process.exit = origExit;
    console.log = origLog;
    process.stdout.write = origStdoutWrite;
  });
});
