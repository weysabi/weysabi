#!/usr/bin/env bun
import { createSabiProject } from "@weysabi/sabi/cli";
import packageJson from "../package.json" with { type: "json" };

const [projectName] = process.argv.slice(2);

if (!projectName || projectName.startsWith("-")) {
  console.error(`Usage: create-sabi-app <project-name> [--template <template>]`);
  console.error(`  Templates: server, nextjs, tanstack, agent (default: server)`);
  process.exit(1);
}

const templateIndex = process.argv.indexOf("--template");
const template = templateIndex !== -1 ? process.argv[templateIndex + 1] : "server";
const noInstall = process.argv.includes("--no-install");

const result = await createSabiProject(projectName, {
  template: template as "server" | "nextjs" | "tanstack" | "agent",
  install: !noInstall,
});

console.log(`Created Sabi project: ${projectName}`);
console.log("Next steps:");
for (const step of result.nextSteps) {
  console.log(`  ${step}`);
}
