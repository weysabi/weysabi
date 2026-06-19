import * as p from "@clack/prompts";
import {
  loadConfig,
  resolveProviders,
  printTable,
  statusIcon,
  testProvider,
  providerLabel,
} from "../utils";

export async function configValidateCommand(): Promise<void> {
  p.intro("sabi config validate");

  const loaded = loadConfig();
  if (!loaded) {
    p.log.warn("No sabi.json config found. Run `sabi init` to create one.");
    p.log.step("Falling back to environment variables...");
  }

  const configured = loaded?.config.providers;
  const providers = resolveProviders(configured);

  const entries = Object.entries(providers);
  if (entries.length === 0) {
    p.log.error("No providers configured. Set env vars or run `sabi init`.");
    p.outro("Validation failed");
    process.exit(1);
  }

  p.log.step(`Found ${entries.length} provider(s). Testing each...`);

  const results: Array<{
    name: string;
    ok: boolean;
    latencyMs: number;
    error?: string;
  }> = [];

  for (const [name, config] of entries) {
    const spinner = p.spinner();
    spinner.start(`Testing ${providerLabel(name)}...`);
    const result = await testProvider(name, config);
    spinner.stop(
      result.ok
        ? `${statusIcon(true)} ${providerLabel(name)} — ${result.latencyMs}ms`
        : `${statusIcon(false)} ${providerLabel(name)} — ${result.error}`
    );
    results.push({ name, ...result });
  }

  console.log();
  const header = ["Provider", "Status", "Latency", "Error"];
  const rows = results.map((r) => [
    providerLabel(r.name),
    r.ok ? "OK" : "FAIL",
    r.ok ? `${r.latencyMs}ms` : "-",
    r.error ?? "",
  ]);
  printTable([header, ...rows]);

  const allOk = results.every((r) => r.ok);
  p.outro(allOk ? "All providers OK" : `${results.filter((r) => !r.ok).length} provider(s) failed`);
  if (!allOk) process.exit(1);
}
