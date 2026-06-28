import { afterAll, beforeAll, describe } from "bun:test";
import postgres from "postgres";
import {
  projectStoreContractTests,
  promptStoreContractTests,
  conversationStoreContractTests,
  runStoreContractTests,
  documentStoreContractTests,
  apiKeyStoreContractTests,
} from "./contract-tests";
import { createPostgresControlPlaneStore } from "./pg-store";
import type {
  ProjectStore,
  PromptStore,
  ConversationStore,
  RunStore,
  DocumentStore,
  ApiKeyStore,
} from "./store";

// Postgres tests require WEYSABI_TEST_POSTGRES_URL to be set.
// CI can skip these tests until a service container is configured.
const PG_URL = process.env.WEYSABI_TEST_POSTGRES_URL;

function projectFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.projects as ProjectStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

function promptFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.prompts as PromptStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

function conversationFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.conversations as ConversationStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

function runFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.runs as RunStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

function documentFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.documents as DocumentStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

function apiKeyFactory() {
  const cp = createPostgresControlPlaneStore({
    connectionString: PG_URL!,
  });
  const store = cp.apiKeys as ApiKeyStore & { close(): Promise<void> };
  store.close = () => cp.close();
  return store;
}

if (!PG_URL) {
  describe.skip("Postgres control-plane store", () => {});
} else {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = postgres(PG_URL);
    await sql.unsafe(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
    `);
  });

  afterAll(async () => {
    await sql.end();
  });

  describe("Postgres control-plane store", () => {
    projectStoreContractTests("Postgres", projectFactory);
    promptStoreContractTests("Postgres", promptFactory);
    conversationStoreContractTests("Postgres", conversationFactory);
    runStoreContractTests("Postgres", runFactory);
    documentStoreContractTests("Postgres", documentFactory);
    apiKeyStoreContractTests("Postgres", apiKeyFactory);
  });
}
