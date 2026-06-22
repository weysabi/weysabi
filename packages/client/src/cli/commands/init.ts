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
  for (const name of selectedProviders as string[]) {
    const envVar = `${name.toUpperCase()}_API_KEY`;
    const envValue = process.env[envVar];
    if (envValue) {
      providers[name] = { apiKey: envValue };
      continue;
    }
    const key = await p.password({
      message: `Enter your ${providerLabel(name)} API key`,
      validate: (v) => (v ? undefined : "Key is required"),
    });
    if (p.isCancel(key)) process.exit(0);
    providers[name] = { apiKey: key as string };
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

  const gitignorePath = resolve(projectDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".sabi/")) {
      writeFileSync(gitignorePath, content + "\n.sabi/\n", "utf-8");
      p.log.step("Added .sabi/ to .gitignore");
    }
  }

  p.outro("sabi is ready. Run `sabi config validate` to verify your keys.");
}
