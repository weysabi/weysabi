import { describe, it, expect } from "bun:test";
import type {
  ProjectStore,
  PromptStore,
  ConversationStore,
  RunStore,
  DocumentStore,
  ApiKeyStore,
} from "./store";

export function projectStoreContractTests(
  label: string,
  createStore: () => ProjectStore & { close(): Promise<void> }
): void {
  describe(`ProjectStore contract — ${label}`, () => {
    it("creates and retrieves a project by id", async () => {
      const store = createStore();
      try {
        const project = await store.create({
          name: "Test Project",
          slug: "test-project",
          metadata: { env: "test" },
          settings: { defaultModel: "groq/llama-4-scout" },
        });

        expect(project.id).toBeTruthy();
        expect(project.name).toBe("Test Project");
        expect(project.slug).toBe("test-project");
        expect(project.metadata).toEqual({ env: "test" });
        expect(project.settings.defaultModel).toBe("groq/llama-4-scout");
        expect(project.createdAt).toBeGreaterThan(0);
        expect(project.updatedAt).toBeGreaterThan(0);

        const retrieved = await store.get(project.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe("Test Project");
      } finally {
        await store.close();
      }
    });

    it("retrieves a project by slug", async () => {
      const store = createStore();
      try {
        await store.create({ name: "My App", slug: "my-app" });
        const found = await store.getBySlug("my-app");
        expect(found).not.toBeNull();
        expect(found!.name).toBe("My App");
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown project id", async () => {
      const store = createStore();
      try {
        const result = await store.get("nonexistent");
        expect(result).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown slug", async () => {
      const store = createStore();
      try {
        const result = await store.getBySlug("does-not-exist");
        expect(result).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("rejects duplicate slugs", async () => {
      const store = createStore();
      try {
        await store.create({ name: "First", slug: "same-slug" });
        await expect(store.create({ name: "Second", slug: "same-slug" })).rejects.toThrow();
      } finally {
        await store.close();
      }
    });

    it("lists projects with pagination", async () => {
      const store = createStore();
      try {
        for (let i = 0; i < 5; i++) {
          await store.create({ name: `Project ${i}`, slug: `proj-${i}` });
        }

        const all = await store.list();
        expect(all.items).toHaveLength(5);
        expect(all.total).toBe(5);

        const page = await store.list({ limit: 2, offset: 1 });
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(5);
      } finally {
        await store.close();
      }
    });

    it("updates a project", async () => {
      const store = createStore();
      try {
        const project = await store.create({ name: "Original", slug: "original" });
        const updated = await store.update(project.id, {
          name: "Updated",
          metadata: { key: "value" },
        });

        expect(updated.name).toBe("Updated");
        expect(updated.slug).toBe("original");
        expect(updated.metadata).toEqual({ key: "value" });
        expect(updated.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);
      } finally {
        await store.close();
      }
    });

    it("deletes a project", async () => {
      const store = createStore();
      try {
        const project = await store.create({ name: "Delete Me", slug: "delete-me" });
        await store.delete(project.id);

        const retrieved = await store.get(project.id);
        expect(retrieved).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("enforces project isolation — two projects with different ids", async () => {
      const store = createStore();
      try {
        const a = await store.create({ name: "Project A", slug: "proj-a" });
        const b = await store.create({ name: "Project B", slug: "proj-b" });

        const gotA = await store.get(a.id);
        const gotB = await store.get(b.id);

        expect(gotA!.name).toBe("Project A");
        expect(gotB!.name).toBe("Project B");
        expect(gotA!.slug).not.toBe(gotB!.slug);
      } finally {
        await store.close();
      }
    });
  });
}

// ─── PromptStore contract tests ─────────────────────────────

export function promptStoreContractTests(
  label: string,
  createStore: () => PromptStore & { close(): Promise<void> }
): void {
  describe(`PromptStore contract — ${label}`, () => {
    it("creates and retrieves a prompt", async () => {
      const store = createStore();
      try {
        const prompt = await store.createPrompt({
          projectId: "proj-1",
          name: "Support Agent",
          slug: "support-agent",
        });
        expect(prompt.id).toBeTruthy();
        expect(prompt.name).toBe("Support Agent");
        expect(prompt.slug).toBe("support-agent");
        expect(prompt.projectId).toBe("proj-1");

        const retrieved = await store.getPrompt("proj-1", prompt.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe("Support Agent");
      } finally {
        await store.close();
      }
    });

    it("retrieves a prompt by slug", async () => {
      const store = createStore();
      try {
        await store.createPrompt({ projectId: "proj-1", name: "Test", slug: "my-prompt" });
        const found = await store.getPromptBySlug("proj-1", "my-prompt");
        expect(found).not.toBeNull();
        expect(found!.name).toBe("Test");
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown prompt", async () => {
      const store = createStore();
      try {
        expect(await store.getPrompt("proj-1", "nonexistent")).toBeNull();
        expect(await store.getPromptBySlug("proj-1", "nope")).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("rejects duplicate slugs within a project", async () => {
      const store = createStore();
      try {
        await store.createPrompt({ projectId: "proj-1", name: "First", slug: "same" });
        await expect(
          store.createPrompt({ projectId: "proj-1", name: "Second", slug: "same" })
        ).rejects.toThrow();
      } finally {
        await store.close();
      }
    });

    it("allows the same slug in different projects", async () => {
      const store = createStore();
      try {
        await store.createPrompt({ projectId: "proj-1", name: "A", slug: "dup" });
        const b = await store.createPrompt({ projectId: "proj-2", name: "B", slug: "dup" });
        expect(b.slug).toBe("dup");
      } finally {
        await store.close();
      }
    });

    it("lists prompts scoped to a project", async () => {
      const store = createStore();
      try {
        await store.createPrompt({ projectId: "proj-1", name: "A", slug: "a" });
        await store.createPrompt({ projectId: "proj-1", name: "B", slug: "b" });
        await store.createPrompt({ projectId: "proj-2", name: "C", slug: "c" });

        const page = await store.listPrompts("proj-1");
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("updates a prompt", async () => {
      const store = createStore();
      try {
        const p = await store.createPrompt({ projectId: "proj-1", name: "Old", slug: "old" });
        const updated = await store.updatePrompt("proj-1", p.id, {
          name: "New",
          description: "desc",
        });
        expect(updated.name).toBe("New");
        expect(updated.description).toBe("desc");
      } finally {
        await store.close();
      }
    });

    it("deletes a prompt", async () => {
      const store = createStore();
      try {
        const p = await store.createPrompt({ projectId: "proj-1", name: "Del", slug: "del" });
        await store.deletePrompt("proj-1", p.id);
        expect(await store.getPrompt("proj-1", p.id)).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("creates and lists prompt versions", async () => {
      const store = createStore();
      try {
        const p = await store.createPrompt({ projectId: "proj-1", name: "V", slug: "v" });
        const v1 = await store.createVersion({
          projectId: "proj-1",
          promptId: p.id,
          messages: [{ role: "system", content: "You are a helper" }],
        });
        const v2 = await store.createVersion({
          projectId: "proj-1",
          promptId: p.id,
          messages: [{ role: "system", content: "You are an expert" }],
        });
        expect(v1.version).toBe(1);
        expect(v2.version).toBe(2);

        const page = await store.listVersions("proj-1", p.id);
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("publishes a version", async () => {
      const store = createStore();
      try {
        const p = await store.createPrompt({ projectId: "proj-1", name: "P", slug: "p" });
        const v = await store.createVersion({
          projectId: "proj-1",
          promptId: p.id,
          messages: [{ role: "system", content: "You are a helper" }],
        });
        const updated = await store.publishVersion("proj-1", p.id, v.id);
        expect(updated.publishedVersionId).toBe(v.id);

        const fetched = await store.getVersion("proj-1", v.id);
        expect(fetched!.status).toBe("published");
        expect(fetched!.publishedAt).toBeGreaterThan(0);
      } finally {
        await store.close();
      }
    });
  });
}

// ─── ConversationStore contract tests ──────────────────────

export function conversationStoreContractTests(
  label: string,
  createStore: () => ConversationStore & { close(): Promise<void> }
): void {
  describe(`ConversationStore contract — ${label}`, () => {
    it("creates and retrieves a conversation", async () => {
      const store = createStore();
      try {
        const conv = await store.createConversation({
          projectId: "proj-1",
          externalUserId: "user-1",
          title: "Hello",
        });
        expect(conv.id).toBeTruthy();
        expect(conv.projectId).toBe("proj-1");
        expect(conv.externalUserId).toBe("user-1");
        expect(conv.title).toBe("Hello");
        expect(conv.status).toBe("active");

        const retrieved = await store.getConversation("proj-1", conv.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(conv.id);
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown conversation", async () => {
      const store = createStore();
      try {
        expect(await store.getConversation("proj-1", "nonexistent")).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("lists conversations scoped to a project", async () => {
      const store = createStore();
      try {
        await store.createConversation({ projectId: "proj-1", title: "A" });
        await store.createConversation({ projectId: "proj-1", title: "B" });
        await store.createConversation({ projectId: "proj-2", title: "C" });

        const page = await store.listConversations("proj-1");
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("filters conversations by externalUserId", async () => {
      const store = createStore();
      try {
        await store.createConversation({ projectId: "proj-1", externalUserId: "u1", title: "A" });
        await store.createConversation({ projectId: "proj-1", externalUserId: "u2", title: "B" });

        const page = await store.listConversations("proj-1", { externalUserId: "u1" });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]!.title).toBe("A");
      } finally {
        await store.close();
      }
    });

    it("updates a conversation", async () => {
      const store = createStore();
      try {
        const conv = await store.createConversation({ projectId: "proj-1", title: "Old" });
        const updated = await store.updateConversation("proj-1", conv.id, {
          title: "New",
          status: "archived",
        });
        expect(updated.title).toBe("New");
        expect(updated.status).toBe("archived");
      } finally {
        await store.close();
      }
    });

    it("appends and lists messages", async () => {
      const store = createStore();
      try {
        const conv = await store.createConversation({ projectId: "proj-1" });

        const msg1 = await store.appendMessage({
          projectId: "proj-1",
          conversationId: conv.id,
          role: "user",
          content: "Hello",
        });
        const msg2 = await store.appendMessage({
          projectId: "proj-1",
          conversationId: conv.id,
          role: "assistant",
          content: "Hi there",
        });

        expect(msg1.role).toBe("user");
        expect(msg2.role).toBe("assistant");

        const page = await store.listMessages("proj-1", conv.id);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]!.content).toBe("Hello");
      } finally {
        await store.close();
      }
    });

    it("updates a message", async () => {
      const store = createStore();
      try {
        const conv = await store.createConversation({ projectId: "proj-1" });
        const msg = await store.appendMessage({
          projectId: "proj-1",
          conversationId: conv.id,
          role: "user",
          content: "draft",
          status: "pending",
        });
        const updated = await store.updateMessage("proj-1", msg.id, {
          content: "final",
          status: "complete",
          tokenCount: 10,
        });
        expect(updated.content).toBe("final");
        expect(updated.status).toBe("complete");
        expect(updated.tokenCount).toBe(10);
      } finally {
        await store.close();
      }
    });

    it("deletes a conversation and its messages", async () => {
      const store = createStore();
      try {
        const conv = await store.createConversation({ projectId: "proj-1" });
        await store.appendMessage({
          projectId: "proj-1",
          conversationId: conv.id,
          role: "user",
          content: "msg",
        });
        await store.deleteConversation("proj-1", conv.id);

        expect(await store.getConversation("proj-1", conv.id)).toBeNull();
        const msgs = await store.listMessages("proj-1", conv.id);
        expect(msgs.items).toHaveLength(0);
      } finally {
        await store.close();
      }
    });
  });
}

// ─── RunStore contract tests ────────────────────────────────

export function runStoreContractTests(
  label: string,
  createStore: () => RunStore & { close(): Promise<void> }
): void {
  describe(`RunStore contract — ${label}`, () => {
    it("creates and retrieves a run", async () => {
      const store = createStore();
      try {
        const run = await store.create({
          projectId: "proj-1",
          requestedModel: "groq/llama-4-scout",
          status: "pending",
        });
        expect(run.id).toBeTruthy();
        expect(run.projectId).toBe("proj-1");
        expect(run.requestedModel).toBe("groq/llama-4-scout");
        expect(run.status).toBe("pending");
        expect(run.fallbackAttempts).toEqual([]);

        const retrieved = await store.get("proj-1", run.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(run.id);
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown run", async () => {
      const store = createStore();
      try {
        expect(await store.get("proj-1", "nonexistent")).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("updates a run", async () => {
      const store = createStore();
      try {
        const run = await store.create({
          projectId: "proj-1",
          requestedModel: "gpt-4",
        });
        const updated = await store.update("proj-1", run.id, {
          status: "success",
          totalTokens: 100,
          latencyMs: 500,
        });
        expect(updated.status).toBe("success");
        expect(updated.totalTokens).toBe(100);
        expect(updated.latencyMs).toBe(500);
      } finally {
        await store.close();
      }
    });

    it("lists runs scoped to a project", async () => {
      const store = createStore();
      try {
        await store.create({ projectId: "proj-1", requestedModel: "m1" });
        await store.create({ projectId: "proj-1", requestedModel: "m2" });
        await store.create({ projectId: "proj-2", requestedModel: "m3" });

        const page = await store.list("proj-1");
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("filters runs by status", async () => {
      const store = createStore();
      try {
        await store.create({ projectId: "proj-1", requestedModel: "m1", status: "success" });
        await store.create({ projectId: "proj-1", requestedModel: "m2", status: "failed" });
        await store.create({ projectId: "proj-1", requestedModel: "m3", status: "success" });

        const page = await store.list("proj-1", { status: "success" });
        expect(page.items).toHaveLength(2);
      } finally {
        await store.close();
      }
    });

    it("computes run stats", async () => {
      const store = createStore();
      try {
        await store.create({
          projectId: "proj-1",
          requestedModel: "m1",
          status: "success",
          totalTokens: 50,
          latencyMs: 100,
        });
        await store.create({
          projectId: "proj-1",
          requestedModel: "m2",
          status: "success",
          totalTokens: 150,
          latencyMs: 200,
        });
        await store.create({
          projectId: "proj-1",
          requestedModel: "m3",
          status: "failed",
          totalTokens: 0,
          latencyMs: 50,
        });

        const s = await store.stats("proj-1");
        expect(s.totalRuns).toBe(3);
        expect(s.successCount).toBe(2);
        expect(s.failedCount).toBe(1);
        expect(s.totalTokens).toBe(200);
      } finally {
        await store.close();
      }
    });
  });
}

// ─── DocumentStore contract tests ──────────────────────────

export function documentStoreContractTests(
  label: string,
  createStore: () => DocumentStore & { close(): Promise<void> }
): void {
  describe(`DocumentStore contract — ${label}`, () => {
    it("creates and retrieves a document", async () => {
      const store = createStore();
      try {
        const doc = await store.create({
          projectId: "proj-1",
          name: "readme.md",
          sourceType: "file",
          contentHash: "abc123",
        });
        expect(doc.id).toBeTruthy();
        expect(doc.projectId).toBe("proj-1");
        expect(doc.name).toBe("readme.md");
        expect(doc.status).toBe("pending");

        const retrieved = await store.get("proj-1", doc.id);
        expect(retrieved).not.toBeNull();
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown document", async () => {
      const store = createStore();
      try {
        expect(await store.get("proj-1", "nonexistent")).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("lists documents scoped to a project", async () => {
      const store = createStore();
      try {
        await store.create({
          projectId: "proj-1",
          name: "a.md",
          sourceType: "file",
          contentHash: "1",
        });
        await store.create({
          projectId: "proj-1",
          name: "b.md",
          sourceType: "file",
          contentHash: "2",
        });
        await store.create({
          projectId: "proj-2",
          name: "c.md",
          sourceType: "file",
          contentHash: "3",
        });

        const page = await store.list("proj-1");
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("rejects duplicate content hash within a project", async () => {
      const store = createStore();
      try {
        await store.create({
          projectId: "proj-1",
          name: "a.md",
          sourceType: "file",
          contentHash: "dup",
        });
        await expect(
          store.create({
            projectId: "proj-1",
            name: "b.md",
            sourceType: "file",
            contentHash: "dup",
          })
        ).rejects.toThrow();
      } finally {
        await store.close();
      }
    });

    it("updates document status", async () => {
      const store = createStore();
      try {
        const doc = await store.create({
          projectId: "proj-1",
          name: "doc.txt",
          sourceType: "text",
          contentHash: "h1",
        });
        const updated = await store.updateStatus("proj-1", doc.id, "ready");
        expect(updated.status).toBe("ready");
      } finally {
        await store.close();
      }
    });

    it("deletes a document", async () => {
      const store = createStore();
      try {
        const doc = await store.create({
          projectId: "proj-1",
          name: "del.md",
          sourceType: "text",
          contentHash: "h2",
        });
        await store.delete("proj-1", doc.id);
        expect(await store.get("proj-1", doc.id)).toBeNull();
      } finally {
        await store.close();
      }
    });
  });
}

// ─── ApiKeyStore contract tests ────────────────────────────

export function apiKeyStoreContractTests(
  label: string,
  createStore: () => ApiKeyStore & { close(): Promise<void> }
): void {
  describe(`ApiKeyStore contract — ${label}`, () => {
    it("creates and retrieves an API key", async () => {
      const store = createStore();
      try {
        const key = await store.create({
          projectId: "proj-1",
          name: "dev key",
          scopes: ["chat:write", "conversations:read"],
        });
        expect(key.id).toBeTruthy();
        expect(key.projectId).toBe("proj-1");
        expect(key.name).toBe("dev key");
        expect(key.scopes).toEqual(["chat:write", "conversations:read"]);
        expect(key.fingerprint).toBeTruthy();
        expect(key.secret).toStartWith("sabi_");
        expect(key.fingerprint).not.toBe(key.id);
        expect(key.fingerprint).not.toContain(key.secret);

        const retrieved = await store.get("proj-1", key.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe("dev key");
        expect("secret" in retrieved!).toBeFalse();
        const authenticated = await store.findBySecret(key.secret);
        expect(authenticated?.id).toBe(key.id);
        expect(authenticated?.lastUsedAt).toBeGreaterThan(0);
        expect(await store.findBySecret(`${key.secret}-wrong`)).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("returns null for unknown key", async () => {
      const store = createStore();
      try {
        expect(await store.get("proj-1", "nonexistent")).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("lists keys scoped to a project", async () => {
      const store = createStore();
      try {
        await store.create({ projectId: "proj-1", name: "k1" });
        await store.create({ projectId: "proj-1", name: "k2" });
        await store.create({ projectId: "proj-2", name: "k3" });

        const page = await store.list("proj-1");
        expect(page.items).toHaveLength(2);
        expect(page.total).toBe(2);
      } finally {
        await store.close();
      }
    });

    it("updates a key", async () => {
      const store = createStore();
      try {
        const key = await store.create({ projectId: "proj-1", name: "old name" });
        const updated = await store.update("proj-1", key.id, {
          name: "new name",
          scopes: ["project:admin"],
        });
        expect(updated.name).toBe("new name");
        expect(updated.scopes).toEqual(["project:admin"]);
      } finally {
        await store.close();
      }
    });

    it("rejects revoked and expired secrets", async () => {
      const store = createStore();
      try {
        const revoked = await store.create({ projectId: "proj-1", name: "revoked" });
        await store.update("proj-1", revoked.id, { revokedAt: Date.now() });
        expect(await store.findBySecret(revoked.secret)).toBeNull();

        const expired = await store.create({
          projectId: "proj-1",
          name: "expired",
          expiresAt: Date.now() - 1,
        });
        expect(await store.findBySecret(expired.secret)).toBeNull();
      } finally {
        await store.close();
      }
    });

    it("deletes a key", async () => {
      const store = createStore();
      try {
        const key = await store.create({ projectId: "proj-1", name: "del" });
        await store.delete("proj-1", key.id);
        expect(await store.get("proj-1", key.id)).toBeNull();
      } finally {
        await store.close();
      }
    });
  });
}
