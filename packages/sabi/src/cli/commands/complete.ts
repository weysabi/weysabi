import { createWeysabi, errorMessage } from "../../index";
import { resolveProvidersWithGuard } from "../utils";

export async function completeCommand(
  message: string,
  options: { model?: string; noConfig?: boolean }
): Promise<void> {
  const { providers, defaultModel } = resolveProvidersWithGuard(options);

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
    console.error("Error:", errorMessage(err));
    process.exit(1);
  }
}
