import { log } from "./logger";

const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "SABI_OPENAI_API_KEY",
  groq: "SABI_GROQ_API_KEY",
  anthropic: "SABI_ANTHROPIC_API_KEY",
  google: "SABI_GOOGLE_API_KEY",
  mistral: "SABI_MISTRAL_API_KEY",
  deepseek: "SABI_DEEPSEEK_API_KEY",
  together: "SABI_TOGETHER_API_KEY",
  nvidia: "SABI_NVIDIA_API_KEY",
  openrouter: "SABI_OPENROUTER_API_KEY",
  ollama: "SABI_OLLAMA_API_KEY",
};

export function resolveProvidersFromEnv(): Record<string, { apiKey: string }> {
  const providers: Record<string, { apiKey: string }> = {};
  for (const [name, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
    const val = process.env[envVar];
    if (val) {
      providers[name] = { apiKey: val };
    }
  }
  return providers;
}

export function requireProviders(
  providers: Record<string, unknown>
): asserts providers is Record<string, { apiKey: string }> {
  if (Object.keys(providers).length === 0) {
    log.error("No providers configured. Set at least one SABI_*_API_KEY env var.");
    process.exit(1);
  }
}

export function registerShutdownHandlers(stop: () => void): void {
  process.on("SIGINT", () => {
    log.info("Shutting down (SIGINT)");
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    log.info("Shutting down (SIGTERM)");
    stop();
    process.exit(0);
  });
}

export function providerNames(providers: Record<string, { apiKey: string }>): string[] {
  return Object.keys(providers);
}
