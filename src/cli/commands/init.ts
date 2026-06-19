import * as p from "@clack/prompts";
import { resolve } from "path";
import { saveConfig, type SabiConfig, providerLabel } from "../utils";

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

export async function initCommand(): Promise<void> {
  p.intro("sabi init");

  const projectDir = process.cwd();

  const defaultsDir = resolve(projectDir, "sabi-prompts");

  const wantsDefaults = await p.confirm({
    message: "Create a prompts directory?",
    initialValue: true,
  });
  if (p.isCancel(wantsDefaults)) process.exit(0);

  const promptsDir = wantsDefaults ? defaultsDir : undefined;

  const selectedProviders = await p.multiselect({
    message: "Which providers do you use?",
    options: KNOWN_PROVIDERS.map((name) => ({
      value: name,
      label: providerLabel(name),
      hint: `SABI_${name.toUpperCase()}_API_KEY`,
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

  let defaultModel: string | undefined;
  if (selectedProviders.length > 0) {
    const result = await p.text({
      message: "Default model?",
      placeholder: `${selectedProviders[0]}/llama-3.1-8b-instant`,
    });
    if (p.isCancel(result)) process.exit(0);
    defaultModel = result as string;
  }

  const config: SabiConfig = {
    providers,
    ...(defaultModel ? { defaultModel: defaultModel || undefined } : {}),
    ...(promptsDir ? { promptsDir } : {}),
  };

  const path = saveConfig(config, resolve(projectDir, "sabi.json"));

  p.note(`Config saved to ${path}`, "Done");

  if (promptsDir) {
    const { mkdirSync } = await import("fs");
    mkdirSync(promptsDir, { recursive: true });
    p.log.step(`Created ${promptsDir}`);
  }

  p.outro("sabi is ready. Run `sabi config validate` to verify your keys.");
}
