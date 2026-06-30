import * as p from "@clack/prompts";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolveProviders, saveConfig, type WeysabiConfig, providerLabel } from "../utils";
import { providerRegistry, providerIds } from "../../providers/registry";

// Both derived from the central registry
const KNOWN_PROVIDERS = [...providerIds];
const DEFAULT_MODELS: Record<string, string> = Object.fromEntries(
  providerIds.map((id) => [id, providerRegistry[id]!.defaultModel])
);

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
  const additions = [".env", ".weysabi/", "weysabi.json"].filter((entry) => !entries.has(entry));
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

function addGitkeep(dir: string): void {
  const gitkeep = resolve(dir, ".gitkeep");
  if (!existsSync(gitkeep)) writeFileSync(gitkeep, "", "utf-8");
}

export async function initCommand(): Promise<void> {
  p.intro("weysabi init");

  const projectDir = process.cwd();

  const selectedProviders = await p.multiselect({
    message: "Which providers do you use?",
    options: KNOWN_PROVIDERS.map((name) => ({
      value: name,
      label: providerLabel(name),
      hint: `${DEFAULT_MODELS[name] ?? ""} ・ ${name.toUpperCase()}_API_KEY`,
    })),
    required: true,
  });
  if (p.isCancel(selectedProviders)) process.exit(0);

  const providers: Record<string, { apiKey: string }> = {};
  const newEnvValues: Record<string, string> = {};
  for (const name of selectedProviders as string[]) {
    const envVar = `${name.toUpperCase()}_API_KEY`;
    const envValue = process.env[envVar];
    if (envValue) {
      providers[name] = { apiKey: "" };
      p.log.info(`${providerLabel(name)} key found in ${envVar}`);
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

  const modelOptions = (selectedProviders as string[]).map((name) => ({
    value: DEFAULT_MODELS[name] ?? `${name}/model-id`,
    label: DEFAULT_MODELS[name] ?? `${name}/model-id`,
  }));
  const uniqueModels = modelOptions.filter(
    (opt, i, arr) => arr.findIndex((o) => o.value === opt.value) === i
  );

  let defaultModel: string | undefined;
  if (uniqueModels.length > 0) {
    const modelChoice = await p.select({
      message: "Default model?",
      options: [...uniqueModels, { value: "__custom__", label: "Custom model…" }],
    });
    if (p.isCancel(modelChoice)) process.exit(0);

    if (modelChoice === "__custom__") {
      const custom = await p.text({
        message: "Enter model identifier",
        placeholder: uniqueModels[0]?.value ?? "provider/model-id",
        validate: (v) => (v ? undefined : "Model is required"),
      });
      if (p.isCancel(custom)) process.exit(0);
      defaultModel = custom as string;
    } else {
      defaultModel = modelChoice as string;
    }
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
    addGitkeep(promptsDir);
    for (const [name, content] of Object.entries(EXAMPLE_PROMPT)) {
      const fp = resolve(promptsDir, name);
      if (!existsSync(fp)) {
        writeFileSync(fp, content, "utf-8");
      }
    }
    const readme = resolve(promptsDir, "README.md");
    if (!existsSync(readme)) {
      writeFileSync(
        readme,
        `# Prompts

Example prompt templates for use with \`weysabi.prompts.register()\`.

Each file is a plain text template with \`{variable}\` placeholders.
Use \`weysabi\`'s prompt registry to load and render them:

\`\`\`ts
import { createWeysabi } from "weysabi";

const weysabi = createWeysabi({ /* providers */ });

weysabi.prompts.register({
  id: "classify",
  messages: [
    {
      role: "user",
      content: readFileSync("./prompts/classify.prompt.txt", "utf-8"),
    },
  ],
  model: "groq/llama-4-scout",
});

const result = await weysabi.prompts.run("classify", {
  ticket_text: "I was overcharged for my subscription",
});
\`\`\`

See the [docs](https://weysabi.co/docs/prompts) for more.
`
      );
    }
    p.log.step(`Created example prompts in ${promptsDir}/`);
  }

  const config: WeysabiConfig = {
    providers,
    ...(defaultModel ? { defaultModel } : {}),
    ...(promptsDir ? { promptsDir } : {}),
  };

  const configPath = saveConfig(config, resolve(projectDir, "weysabi.json"));
  p.note(`Config saved to ${configPath}`, "Done");

  if (Object.keys(newEnvValues).length > 0) {
    upsertEnvFile(projectDir, newEnvValues);
    p.log.step("Saved provider credentials to .env");
  }

  ensureGitignore(projectDir);
  p.log.step("Added Sabi entries to .gitignore");

  const shouldTest = await p.confirm({
    message: "Test provider connectivity now?",
    initialValue: true,
  });
  if (p.isCancel(shouldTest)) process.exit(0);

  if (shouldTest) {
    for (const [key, value] of Object.entries(newEnvValues)) {
      process.env[key] = value;
    }
    const { testProvider, statusIcon, providerLabel } = await import("../utils");
    const resolvedProviders = resolveProviders(providers);
    const s = p.spinner();
    const names = Object.keys(providers);
    for (const name of names) {
      s.start(`Testing ${providerLabel(name)}...`);
      const provider = resolvedProviders[name];
      const result = provider?.apiKey
        ? await testProvider(name, provider)
        : { ok: false, latencyMs: 0, error: `No credential resolved for ${name}` };
      s.stop(
        `${statusIcon(result.ok)} ${providerLabel(name)} — ${result.ok ? `${result.latencyMs}ms` : result.error}`
      );
    }
  }

  p.outro("weysabi is ready. Run `weysabi config validate` to re-test.");
}
