import type { Weysabi } from "@weysabi/sabi";
import type { IdempotencyInstance } from "../middleware";
import type { ControlPlaneStore } from "./store";
import { createPromptService } from "./prompt-service";
import { createProjectService } from "./service";
import type { HonoApp, ControlRouteContext } from "./routes/common";
import { registerApiKeyRoutes } from "./routes/api-keys";
import { registerConversationRoutes } from "./routes/conversations";
import { registerDocumentRoutes } from "./routes/documents";
import { registerProjectRoutes } from "./routes/projects";
import { registerPromptRoutes } from "./routes/prompts";
import { registerRunRoutes } from "./routes/runs";

export interface RegisterControlRoutesOptions {
  idempotency?: IdempotencyInstance;
}

export function registerControlRoutes(
  app: HonoApp,
  sabi: Weysabi,
  store: ControlPlaneStore,
  options: RegisterControlRoutesOptions = {}
): void {
  const context: ControlRouteContext = {
    app,
    sabi,
    store,
    projects: createProjectService(store.projects),
    prompts: createPromptService(store.prompts),
    idempotency: options.idempotency,
  };

  registerProjectRoutes(context);
  registerPromptRoutes(context);
  registerConversationRoutes(context);
  registerRunRoutes(context);
  registerDocumentRoutes(context);
  registerApiKeyRoutes(context);
}
