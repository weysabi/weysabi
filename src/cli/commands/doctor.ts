import { statusIcon, printTable } from "../utils";

export async function doctorCommand(): Promise<void> {
  console.log("sabi doctor — System Diagnostics\n");

  const checks: Array<[string, boolean, string]> = [];

  const isBun = typeof Bun !== "undefined";
  checks.push(["Runtime", isBun, isBun ? `Bun ${Bun.version}` : `Node ${process.version}`]);

  const bunMajor = isBun ? parseInt(Bun.version.split(".")[0]!, 10) : 0;
  const bunMinor = isBun ? parseInt(Bun.version.split(".")[1]!, 10) : 0;
  const bunOk = bunMajor > 1 || (bunMajor === 1 && bunMinor >= 3);
  checks.push(["Bun >= 1.3", bunOk, bunOk ? "OK" : "Upgrade required (minimum 1.3.x)"]);

  const envProviders = [
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "NVIDIA_API_KEY",
    "DEEPSEEK_API_KEY",
    "TOGETHER_API_KEY",
    "OPENROUTER_API_KEY",
  ];
  const found = envProviders.filter((k) => process.env[k]);
  checks.push([
    "API Keys (env)",
    found.length > 0,
    found.length > 0
      ? `${found.length} found: ${found.join(", ")}`
      : "None found — run `sabi init`",
  ]);

  const { loadConfig } = await import("../utils");
  const config = loadConfig();
  checks.push([
    "Config file",
    config !== null,
    config ? config.path : "Not found — run `sabi init`",
  ]);

  const pkgPath = new URL("../../../package.json", import.meta.url);
  try {
    const pkg = await import(pkgPath.toString());
    checks.push(["sabi version", true, `v${pkg.version ?? "unknown"}`]);
  } catch {
    checks.push(["sabi version", false, "Could not read package.json"]);
  }

  printTable([
    ["Check", "Status", "Detail"],
    ...checks.map(([c, ok, d]) => [c, ok ? statusIcon(true) : statusIcon(false), d]),
  ]);

  const allOk = checks.every(([, ok]) => ok);
  console.log(allOk ? "\nAll checks passed." : "\nSome checks failed. See above.");
  if (!allOk) process.exit(1);
}
