import { unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import {
  projectStoreContractTests,
  promptStoreContractTests,
  conversationStoreContractTests,
  runStoreContractTests,
  documentStoreContractTests,
  apiKeyStoreContractTests,
} from "./contract-tests";
import { createSqliteControlPlaneStore } from "./sqlite-store";
import type {
  ProjectStore,
  PromptStore,
  ConversationStore,
  RunStore,
  DocumentStore,
  ApiKeyStore,
} from "./store";

function tempDbPath(): string {
  return resolve(tmpdir(), `weysabi-control-test-${randomUUID()}.db`);
}

function createProjectStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  const store = cp.projects as ProjectStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function seedProjects(dbPath: string): void {
  const db = new Database(dbPath);
  const timestamp = Date.now();
  for (const id of ["proj-1", "proj-2"]) {
    db.run(
      "INSERT INTO projects (id, name, slug, metadata, settings, created_at, updated_at) VALUES (?, ?, ?, '{}', '{}', ?, ?)",
      [id, id, id, timestamp, timestamp]
    );
  }
  db.close();
}

function createPromptStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  seedProjects(dbPath);
  const store = cp.prompts as PromptStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function createConversationStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  seedProjects(dbPath);
  const store = cp.conversations as ConversationStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function createRunStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  seedProjects(dbPath);
  const store = cp.runs as RunStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function createDocumentStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  seedProjects(dbPath);
  const store = cp.documents as DocumentStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function createApiKeyStore() {
  const dbPath = tempDbPath();
  const cp = createSqliteControlPlaneStore(dbPath);
  seedProjects(dbPath);
  const store = cp.apiKeys as ApiKeyStore & { close(): Promise<void> };
  store.close = async () => {
    await cp.close();
    cleanup(dbPath);
  };
  return store;
}

function cleanup(dbPath: string): void {
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // Windows may still hold the lock
    }
  }
}

projectStoreContractTests("SQLite", createProjectStore);
promptStoreContractTests("SQLite", createPromptStore);
conversationStoreContractTests("SQLite", createConversationStore);
runStoreContractTests("SQLite", createRunStore);
documentStoreContractTests("SQLite", createDocumentStore);
apiKeyStoreContractTests("SQLite", createApiKeyStore);

describe("SQLite control-plane integrity", () => {
  it("rejects orphaned and cross-project child resources", async () => {
    const dbPath = tempDbPath();
    const store = createSqliteControlPlaneStore(dbPath);
    try {
      const project = await store.projects.create({ name: "Project", slug: "project" });
      const conversation = await store.conversations.createConversation({
        projectId: project.id,
      });

      await expect(
        store.prompts.createPrompt({
          projectId: "missing-project",
          name: "Prompt",
          slug: "prompt",
        })
      ).rejects.toThrow();
      await expect(
        store.conversations.appendMessage({
          projectId: "missing-project",
          conversationId: conversation.id,
          role: "user",
          content: "orphan",
        })
      ).rejects.toThrow();
      await expect(
        store.documents.create({
          projectId: "missing-project",
          name: "orphan",
          sourceType: "text",
          contentHash: "orphan",
        })
      ).rejects.toThrow();
      await expect(
        store.apiKeys.create({ projectId: "missing-project", name: "orphan" })
      ).rejects.toThrow();
      await expect(
        store.runs.create({
          projectId: project.id,
          conversationId: "missing-conversation",
          requestedModel: "test/model",
        })
      ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    } finally {
      await store.close();
      cleanup(dbPath);
    }
  });

  it("cascades project deletion across managed resources", async () => {
    const dbPath = tempDbPath();
    const store = createSqliteControlPlaneStore(dbPath);
    try {
      const project = await store.projects.create({ name: "Project", slug: "project" });
      const prompt = await store.prompts.createPrompt({
        projectId: project.id,
        name: "Prompt",
        slug: "prompt",
      });
      await store.prompts.createVersion({
        projectId: project.id,
        promptId: prompt.id,
        messages: [],
      });
      const conversation = await store.conversations.createConversation({
        projectId: project.id,
      });
      await store.conversations.appendMessage({
        projectId: project.id,
        conversationId: conversation.id,
        role: "user",
        content: "hello",
      });
      await store.runs.create({ projectId: project.id, requestedModel: "test/model" });
      await store.documents.create({
        projectId: project.id,
        name: "doc",
        sourceType: "text",
        contentHash: "hash",
      });
      await store.apiKeys.create({ projectId: project.id, name: "key" });

      await store.projects.delete(project.id);

      expect((await store.prompts.listPrompts(project.id)).total).toBe(0);
      expect((await store.conversations.listConversations(project.id)).total).toBe(0);
      expect((await store.runs.list(project.id)).total).toBe(0);
      expect((await store.documents.list(project.id)).total).toBe(0);
      expect((await store.apiKeys.list(project.id)).total).toBe(0);
    } finally {
      await store.close();
      cleanup(dbPath);
    }
  });

  it("publishes only versions owned by the target prompt and archives the previous version", async () => {
    const dbPath = tempDbPath();
    const store = createSqliteControlPlaneStore(dbPath);
    try {
      const project = await store.projects.create({ name: "Project", slug: "project" });
      const first = await store.prompts.createPrompt({
        projectId: project.id,
        name: "First",
        slug: "first",
      });
      const second = await store.prompts.createPrompt({
        projectId: project.id,
        name: "Second",
        slug: "second",
      });
      const v1 = await store.prompts.createVersion({
        projectId: project.id,
        promptId: first.id,
        messages: [],
      });
      const v2 = await store.prompts.createVersion({
        projectId: project.id,
        promptId: first.id,
        messages: [],
      });
      const other = await store.prompts.createVersion({
        projectId: project.id,
        promptId: second.id,
        messages: [],
      });

      await store.prompts.publishVersion(project.id, first.id, v1.id);
      await store.prompts.publishVersion(project.id, first.id, v2.id);
      await expect(
        store.prompts.publishVersion(project.id, first.id, other.id)
      ).rejects.toMatchObject({ code: "PROMPT_VERSION_MISMATCH" });

      expect((await store.prompts.getVersion(project.id, v1.id))?.status).toBe("archived");
      expect((await store.prompts.getVersion(project.id, v2.id))?.status).toBe("published");
    } finally {
      await store.close();
      cleanup(dbPath);
    }
  });

  it("persists migration state and reopens an initialized database", async () => {
    const dbPath = tempDbPath();
    const first = createSqliteControlPlaneStore(dbPath);
    const project = await first.projects.create({ name: "Project", slug: "project" });
    await first.close();

    const reopened = createSqliteControlPlaneStore(dbPath);
    try {
      expect((await reopened.projects.get(project.id))?.slug).toBe("project");
    } finally {
      await reopened.close();
      cleanup(dbPath);
    }
  });

  it("allocates unique prompt version numbers across concurrent calls", async () => {
    const dbPath = tempDbPath();
    const store = createSqliteControlPlaneStore(dbPath);
    try {
      const project = await store.projects.create({ name: "Project", slug: "project" });
      const prompt = await store.prompts.createPrompt({
        projectId: project.id,
        name: "Prompt",
        slug: "prompt",
      });
      const versions = await Promise.all(
        Array.from({ length: 10 }, () =>
          store.prompts.createVersion({
            projectId: project.id,
            promptId: prompt.id,
            messages: [],
          })
        )
      );

      expect(
        versions.map((version) => version.version).sort((left, right) => left - right)
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await store.close();
      cleanup(dbPath);
    }
  });

  it("refuses an unversioned preview schema instead of silently accepting it", () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    legacy.run("CREATE TABLE projects (id TEXT PRIMARY KEY)");
    legacy.close();

    try {
      expect(() => createSqliteControlPlaneStore(dbPath)).toThrow(
        "Unsupported preview control-plane schema"
      );
    } finally {
      cleanup(dbPath);
    }
  });
});
