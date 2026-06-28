import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { CreateTemplate } from "./create";
import { getProjectTemplate, TEMPLATE_OWNED_FILES } from "./create";

interface SabiTemplateMarker {
  template: CreateTemplate;
  version: string;
}

function findMarker(cwd: string): { marker: SabiTemplateMarker; dir: string } | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 10; i++) {
    const path = resolve(dir, ".sabi-template.json");
    if (existsSync(path)) {
      const marker = JSON.parse(readFileSync(path, "utf-8")) as SabiTemplateMarker;
      if (!marker.template || !marker.version) return null;
      return { marker, dir };
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function upgradeCommand(projectName?: string): Promise<void> {
  const cwd = projectName ? resolve(process.cwd(), projectName) : process.cwd();
  const found = findMarker(cwd);

  if (!found) {
    throw new Error(
      "No Sabi project found. Run this command inside a generated project or pass a project directory."
    );
  }

  const { marker, dir } = found;
  const template = getProjectTemplate(marker.template, dir.split(/[/\\]/).pop() ?? "project");
  const owned = TEMPLATE_OWNED_FILES[marker.template];
  const ownedSet = new Set(owned);

  let updated = 0;
  const skipped = 0;

  for (const file of template.files) {
    if (!ownedSet.has(file.path)) continue;
    const target = resolve(dir, file.path);
    const existing = existsSync(target) ? readFileSync(target, "utf-8") : null;

    if (existing === file.content) continue;

    writeFileSync(target, file.content, "utf-8");
    updated++;
  }

  console.log(`Upgraded ${marker.template} project at ${dir}`);
  console.log(`  ${updated} files updated`);
  if (skipped > 0) console.log(`  ${skipped} files skipped (user-modified)`);
  console.log("Review changes with: git diff");
}
