import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, basename, extname } from "path";
import * as p from "@clack/prompts";
import { loadConfig, printTable } from "../utils";

function getPromptsDir(): string | null {
  const loaded = loadConfig();
  if (loaded?.config.promptsDir) {
    return resolve(process.cwd(), loaded.config.promptsDir);
  }
  const cwd = process.cwd();
  const candidates = ["sabi-prompts", "prompts", ".sabi/prompts"];
  for (const dir of candidates) {
    const full = resolve(cwd, dir);
    if (existsSync(full)) return full;
  }
  return null;
}

export async function promptListCommand(): Promise<void> {
  const dir = getPromptsDir();
  if (!dir || !existsSync(dir)) {
    console.log("No prompts directory found. Set promptsDir in sabi.json.");
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".txt") || f.endsWith(".sabi"));
  if (files.length === 0) {
    console.log("No prompt files found.");
    return;
  }

  const header = ["Name", "Size", "Preview"];
  const rows = files.map((f) => {
    const content = readFileSync(resolve(dir, f), "utf-8");
    const preview = content.slice(0, 80).replace(/\n/g, " ").trim();
    return [
      basename(f, extname(f)),
      `${content.length}B`,
      preview.length > 77 ? preview + "..." : preview,
    ];
  });
  printTable([header, ...rows]);
}

export async function promptAddCommand(name: string, content?: string): Promise<void> {
  const dir = getPromptsDir();
  if (!dir) {
    console.error("Set promptsDir in sabi.json first.");
    process.exit(1);
  }

  const { mkdirSync } = await import("fs");
  mkdirSync(dir, { recursive: true });

  const filePath = resolve(dir, `${name}.txt`);

  if (existsSync(filePath)) {
    const overwrite = await p.confirm({
      message: `"${name}" already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      console.log("Cancelled.");
      return;
    }
  }

  if (!content) {
    const result = await p.text({
      message: "Enter prompt template content:",
      validate: (v) => (v ? undefined : "Cannot be empty"),
    });
    if (p.isCancel(result)) process.exit(0);
    content = result as string;
  }

  writeFileSync(filePath, content, "utf-8");
  console.log(`Saved "${name}" (${content.length}B)`);
}

export async function promptRemoveCommand(name: string): Promise<void> {
  const dir = getPromptsDir();
  if (!dir) {
    console.error("No prompts directory found.");
    process.exit(1);
  }

  const filePath = resolve(dir, `${name}.txt`);
  if (!existsSync(filePath)) {
    console.error(`Prompt "${name}" not found.`);
    process.exit(1);
  }

  const { rmSync } = await import("fs");
  rmSync(filePath);
  console.log(`Removed "${name}"`);
}
