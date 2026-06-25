import * as p from "@clack/prompts";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { saveConfig, type WeysabiConfig, providerLabel } from "../utils";

const KNOWN_PROVIDERS = [
  "groq",
  "openai",
  "anthropic",
  "google",
  "mistral",
  "nvidia",
  "deepseek",
  "together",
  "openrouter",
  "ollama",
] as const;

const DEFAULT_MODELS: Record<string, string> = {
  groq: "groq/llama-4-scout",
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

const EXAMPLE_PROMPT = {
  "classify.prompt.txt": `You are a support ticket classifier.
Classify the following ticket into one of these categories:
- billing
- technical
- account
- feature_request

Ticket: {ticket_text}

Respond with just the category name.`,
  "translate.prompt.txt": `Translate the following text to {language}.
Keep the tone and formality level of the original.

Text: {text}

Translation:`,
};

export function ensureGitignore(projectDir: string): void {
  const gitignorePath = resolve(projectDir, ".gitignore");
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const entries = new Set(
    current
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const additions = [".env", ".sabi/", "sabi.json"].filter((entry) => !entries.has(entry));
  if (additions.length === 0) return;

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${current}${prefix}${additions.join("\n")}\n`, "utf-8");
}

export function upsertEnvFile(projectDir: string, values: Record<string, string>): string {
  const envPath = resolve(projectDir, ".env");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = current.split(/\r?\n/u);
  const pending = new Map(Object.entries(values));
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/u);
    if (!match || !pending.has(match[1]!)) return line;
    const key = match[1]!;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });

  while (updated.length > 0 && updated.at(-1) === "") updated.pop();
  for (const [key, value] of pending) updated.push(`${key}=${value}`);
  writeFileSync(envPath, `${updated.join("\n")}\n`, "utf-8");
  return envPath;
}

export async function initCommand(): Promise<void> {
  p.intro("sabi init");

  const projectDir = process.cwd();

  const selectedProviders = await p.multiselect({
    message: "Which providers do you use?",
    options: KNOWN_PROVIDERS.map((name) => ({
      value: name,
      label: providerLabel(name),
      hint: `${name.toUpperCase()}_API_KEY`,
    })),
    required: false,
  });
  if (p.isCancel(selectedProviders)) process.exit(0);

  const providers: Record<string, { apiKey: string }> = {};
  const newEnvValues: Record<string, string> = {};
  for (const name of selectedProviders as string[]) {
    const envVar = `${name.toUpperCase()}_API_KEY`;
    const envValue = process.env[envVar];
    if (envValue) {
      providers[name] = { apiKey: "" };
      continue;
    }
    const key = await p.password({
      message: `Enter your ${providerLabel(name)} API key`,
      validate: (v) => (v ? undefined : "Key is required"),
    });
    if (p.isCancel(key)) process.exit(0);
    providers[name] = { apiKey: "" };
    newEnvValues[envVar] = key as string;
  }

  const defaultModelSuggestions = (selectedProviders as string[]).map(
    (name) => DEFAULT_MODELS[name] ?? `${name}/model-id`
  );

  let defaultModel: string | undefined;
  if (defaultModelSuggestions.length > 0) {
    const result = await p.text({
      message: "Default model?",
      placeholder: defaultModelSuggestions[0] ?? "groq/llama-4-scout",
    });
    if (p.isCancel(result)) process.exit(0);
    defaultModel = (result as string) || defaultModelSuggestions[0];
  }

  const wantsPrompts = await p.confirm({
    message: "Create example prompt files?",
    initialValue: true,
  });
  if (p.isCancel(wantsPrompts)) process.exit(0);

  let promptsDir: string | undefined;
  if (wantsPrompts) {
    promptsDir = resolve(projectDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });
    for (const [name, content] of Object.entries(EXAMPLE_PROMPT)) {
      const fp = resolve(promptsDir, name);
      if (!existsSync(fp)) {
        writeFileSync(fp, content, "utf-8");
      }
    }
    p.log.step(`Created ${Object.keys(EXAMPLE_PROMPT).length} example prompts in prompts/`);
  }

  const config: WeysabiConfig = {
    providers,
    ...(defaultModel ? { defaultModel } : {}),
    ...(promptsDir ? { promptsDir } : {}),
  };

  const path = saveConfig(config, resolve(projectDir, "sabi.json"));
  p.note(`Config saved to ${path}`, "Done");

  if (Object.keys(newEnvValues).length > 0) {
    upsertEnvFile(projectDir, newEnvValues);
    p.log.step("Saved provider credentials to .env");
  }

  ensureGitignore(projectDir);
  p.log.step("Added credentials, local Sabi data, and config to .gitignore");

  p.outro("sabi is ready. Run `sabi config validate` to verify your keys.");
}
