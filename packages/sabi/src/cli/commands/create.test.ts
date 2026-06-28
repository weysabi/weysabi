import { describe, it, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "fs";
import { resolve } from "path";
import { validateProjectName, createSabiProject, createCommand } from "./create";

describe("validateProjectName", () => {
  it("accepts valid names", () => {
    expect(validateProjectName("my-app")).toBeNull();
    expect(validateProjectName("my_app")).toBeNull();
    expect(validateProjectName("my.app")).toBeNull();
    expect(validateProjectName("my1")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateProjectName("")).toBeString();
  });

  it("rejects relative path names", () => {
    expect(validateProjectName(".")).toBeString();
    expect(validateProjectName("..")).toBeString();
  });

  it("rejects names with special characters", () => {
    expect(validateProjectName("my app")).toBeString();
    expect(validateProjectName("my/app")).toBeString();
    expect(validateProjectName("my\\app")).toBeString();
  });
});

describe("createSabiProject", () => {
  const templates = ["server", "nextjs", "tanstack", "agent"] as const;

  for (const template of templates) {
    it(`creates a ${template} starter without installing`, async () => {
      const tmpDir = mkdtempSync("sabi-create-");
      try {
        const result = await createSabiProject("test-proj", {
          cwd: tmpDir,
          template: template as "server",
          install: false,
        });

        expect(result.nextSteps).toBeArray();
        expect(result.nextSteps.length).toBeGreaterThan(0);

        const projectDir = resolve(tmpDir, "test-proj");
        expect(existsSync(resolve(projectDir, "package.json"))).toBeTrue();
        expect(existsSync(resolve(projectDir, "README.md"))).toBeTrue();
        expect(existsSync(resolve(projectDir, ".gitignore"))).toBeTrue();

        const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-proj");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  it("rejects existing directories", async () => {
    const tmpDir = mkdtempSync("sabi-create-");
    const projectDir = resolve(tmpDir, "existing");
    mkdirSync(projectDir, { recursive: true });
    try {
      await expect(
        createSabiProject("existing", { cwd: tmpDir, install: false })
      ).rejects.toThrow("already exists");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid project names", async () => {
    await expect(createSabiProject("", { install: false })).rejects.toThrow();
  });
});

describe("createCommand", () => {
  it("throws on unknown template instead of exiting", async () => {
    await expect(createCommand("test", { template: "unknown" })).rejects.toThrow(
      "Unknown template"
    );
  });

  it("throws on invalid project name", async () => {
    await expect(createCommand("", { template: "server" })).rejects.toThrow();
  });
});
