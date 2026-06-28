import * as p from "@clack/prompts";
import {
  loadConfig,
  resolveProviders,
  testProvider,
  printTable,
  statusIcon,
  providerLabel,
} from "../utils";

export async function benchmarkCommand(options: {
  model?: string;
  noConfig?: boolean;
}): Promise<void> {
  p.intro("sabi benchmark");

  let providers: Record<string, { apiKey: string }> = {};

  if (!options.noConfig) {
    const loaded = loadConfig();
    if (loaded) {
      providers = resolveProviders(loaded.config.providers);
    }
  }

  if (Object.keys(providers).length === 0 && !options.noConfig) {
    providers = resolveProviders();
  }

  if (Object.keys(providers).length === 0) {
    p.log.error("No providers configured. Set env vars or run `sabi init`.");
    p.outro("Benchmark cancelled");
    process.exit(1);
  }

  const entries = Object.entries(providers);
  const runs = 3;
  const results: Array<{
    name: string;
    ok: boolean;
    avgLatencyMs: number;
    latencies: number[];
    error?: string;
  }> = [];

  p.log.step(`Benchmarking ${entries.length} provider(s) — ${runs} runs each`);

  for (const [name, config] of entries) {
    const spinner = p.spinner();
    spinner.start(`Testing ${providerLabel(name)}...`);

    const latencies: number[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < runs; i++) {
      const result = await testProvider(name, config, options.model);
      if (result.ok) {
        latencies.push(result.latencyMs);
      } else {
        lastError = result.error;
      }
    }

    const avg =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;

    spinner.stop(
      latencies.length > 0
        ? `${statusIcon(true)} ${providerLabel(name)} — avg ${avg}ms (${latencies.join(", ")}ms)`
        : `${statusIcon(false)} ${providerLabel(name)} — ${lastError}`
    );

    results.push({
      name,
      ok: latencies.length > 0,
      avgLatencyMs: avg,
      latencies,
      error: lastError,
    });
  }

  console.log();
  const header = ["Provider", "Status", "Avg Latency", "Runs", "Error"];
  const rows = results.map((r) => [
    providerLabel(r.name),
    r.ok ? "OK" : "FAIL",
    r.ok ? `${r.avgLatencyMs}ms` : "-",
    r.ok ? `${r.latencies.length}/${runs}` : "-",
    r.error ?? "",
  ]);
  printTable([header, ...rows]);

  p.outro("Benchmark complete");
}
