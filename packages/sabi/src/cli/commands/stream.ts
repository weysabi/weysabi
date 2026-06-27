import { createWeysabi, errorMessage } from "../../index";
import { resolveProvidersWithGuard } from "../utils";

export async function streamCommand(
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

    const stream = sabi.stream({
      model,
      messages: [{ role: "user", content: message }],
    });

    for await (const chunk of stream) {
      process.stdout.write(chunk.content);
    }
    process.stdout.write("\n");
  } catch (err) {
    console.error("Error:", errorMessage(err));
    process.exit(1);
  }
}
