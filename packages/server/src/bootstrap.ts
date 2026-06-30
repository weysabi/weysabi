import { log } from "./logger";
import { providerRegistry, envDiscoverableProviders } from "weysabi/providers/registry";

const PROVIDER_ENV_VARS: Record<string, string> = Object.fromEntries(
  envDiscoverableProviders.map((id) => [id, providerRegistry[id]!.serverEnvVar])
);

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
    log.error("No providers configured. Set at least one WEYSABI_*_API_KEY env var.");
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
