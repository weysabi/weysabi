import type { Weysabi } from "@weysabi/sabi";
import { ControlError, ControlResourceNotFoundError } from "../errors";
import type { IdempotencyInstance } from "../../middleware";
import type { createPromptService } from "../prompt-service";
import type { createProjectService } from "../service";
import type { ControlPlaneStore } from "../store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HonoApp = any;

export interface ControlRouteContext {
  app: HonoApp;
  sabi: Weysabi;
  store: ControlPlaneStore;
  projects: ReturnType<typeof createProjectService>;
  prompts: ReturnType<typeof createPromptService>;
  idempotency?: IdempotencyInstance;
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseJsonBody(c: HonoApp): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new ControlError("Request body must be valid JSON", "INVALID_JSON", 400);
  }
}

export function notFound(resource: string, id: string, code: string): never {
  throw new ControlResourceNotFoundError(resource, id, code);
}

export async function requireProject(
  projects: ControlRouteContext["projects"],
  projectId: string
): Promise<void> {
  if (!(await projects.get(projectId))) {
    notFound("Project", projectId, "PROJECT_NOT_FOUND");
  }
}
