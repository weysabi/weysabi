import { createWeysabi } from "../../index";
import { loadConfig, resolveProviders } from "../utils";

export async function completeCommand(
  message: string,
  options: { model?: string; noConfig?: boolean }
): Promise<void> {
  let providers: Record<string, { apiKey: string }> = {};
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
    console.error("No providers configured. Set API_KEY env vars or run `sabi init`.");
    process.exit(1);
  }

  const model = options.model ?? defaultModel;
  if (!model) {
    console.error("No model specified. Use --model or set defaultModel in sabi.json.");
    process.exit(1);
  }

  try {
    const sabi = createWeysabi(providers, {
      retry: { maxRetries: 0 },
      telemetry: {
        onAttempt: () => {},
        onSuccess: () => {},
        onFailure: () => {},
        onFallback: () => {},
      },
    });

    const result = await sabi.complete({
      model,
      messages: [{ role: "user", content: message }],
    });

    console.log(result.content);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
