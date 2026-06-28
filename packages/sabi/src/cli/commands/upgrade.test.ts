import { describe, it, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "fs";
import { resolve } from "path";
import { createSabiProject } from "./create";
import { upgradeCommand } from "./upgrade";

describe("upgradeCommand", () => {
  it("throws when no project is found", async () => {
    await expect(upgradeCommand("/nonexistent/path")).rejects.toThrow("No Sabi project found");
  });

  it("detects a generated project and upgrades files", async () => {
    const tmpDir = mkdtempSync("sabi-upgrade-");
    try {
      await createSabiProject("test-upgrade", {
        cwd: tmpDir,
        template: "server",
        install: false,
      });

      const projectDir = resolve(tmpDir, "test-upgrade");
      expect(existsSync(resolve(projectDir, ".sabi-template.json"))).toBeTrue();

      const marker = JSON.parse(
        readFileSync(resolve(projectDir, ".sabi-template.json"), "utf-8")
      );
      expect(marker.template).toBe("server");
      expect(marker.version).toBeString();

      await upgradeCommand(projectDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds the marker in parent directories", async () => {
    const tmpDir = mkdtempSync("sabi-upgrade-");
    try {
      await createSabiProject("parent-test", {
        cwd: tmpDir,
        template: "nextjs",
        install: false,
      });

      const nestedDir = resolve(tmpDir, "parent-test", "src", "routes");
      mkdirSync(nestedDir, { recursive: true });

      await upgradeCommand(nestedDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
