import { createApiKeyValidator } from "@joinremba/gate/api-keys";
import type { ApiKeyEntry } from "@joinremba/gate/api-keys";
import { AuthError, InsufficientPermissionsError } from "../errors";
import type { ControlPlaneStore } from "./store";
import type { ProjectScope } from "./types";
import type { HonoApp } from "./routes/common";

interface ScopeRequirement {
  scopes: ProjectScope[];
  match: "any" | "all";
}

function bearerToken(c: HonoApp): string | null {
  const authorization = c.req.header("Authorization");
  const match =
    typeof authorization === "string" ? /^Bearer\s+(.+)$/iu.exec(authorization.trim()) : null;
  return match?.[1]?.trim() || null;
}

function projectIdFromPath(path: string): string | null {
  const match = /^\/v1\/projects\/([^/]+)/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function readRequirement(method: string, path: string): ScopeRequirement | null {
  if (path.includes("/api-keys")) {
    return { scopes: ["project:admin"], match: "all" };
  }

  if (path.endsWith("/messages/send") || path.endsWith("/messages/stream")) {
    return { scopes: ["chat:write", "conversations:write"], match: "any" };
  }

  if (path.includes("/conversations") || /\/v1\/projects\/[^/]+\/messages\/[^/]+$/u.test(path)) {
    return {
      scopes: method === "GET" ? ["conversations:read"] : ["conversations:write"],
      match: "all",
    };
  }

  if (path.endsWith("/execute")) {
    return { scopes: ["chat:write", "prompts:read"], match: "any" };
  }

  if (path.includes("/prompts")) {
    return {
      scopes: method === "GET" ? ["prompts:read"] : ["prompts:write"],
      match: "all",
    };
  }

  if (path.includes("/documents")) {
    return {
      scopes: method === "GET" ? ["documents:read"] : ["documents:write"],
      match: "all",
    };
  }

  if (path.includes("/runs")) {
    return {
      scopes: method === "GET" ? ["usage:read"] : ["project:admin"],
      match: "all",
    };
  }

  return { scopes: ["project:admin"], match: "all" };
}

function hasRequiredScope(scopes: ProjectScope[], requirement: ScopeRequirement): boolean {
  if (scopes.includes("project:admin")) return true;
  if (requirement.match === "any") {
    return requirement.scopes.some((scope) => scopes.includes(scope));
  }
  return requirement.scopes.every((scope) => scopes.includes(scope));
}

export function createControlPlaneAuth(
  adminApiKey: string,
  nonAdminKeys: ApiKeyEntry[],
  store: ControlPlaneStore
) {
  const authenticateAdmin = createApiKeyValidator([
    { key: adminApiKey, scopes: ["admin"] },
  ]).authenticate();
  const authenticateNonAdmin = createApiKeyValidator(nonAdminKeys).authenticate();

  return async (c: HonoApp, next: () => Promise<void>) => {
    const adminResult = await authenticateAdmin(c.req.raw);
    if (adminResult.authenticated) {
      await next();
      return;
    }

    const nonAdminResult = await authenticateNonAdmin(c.req.raw);
    if (nonAdminResult.authenticated) {
      throw new InsufficientPermissionsError("admin");
    }

    const projectId = projectIdFromPath(c.req.path);
    const secret = bearerToken(c);
    if (!projectId || !secret) {
      throw new AuthError("Incorrect admin or project API key provided");
    }

    const projectApiKey = await store.apiKeys.findBySecret(secret);
    if (!projectApiKey) {
      throw new AuthError("Incorrect admin or project API key provided");
    }
    if (projectApiKey.projectId !== projectId) {
      throw new InsufficientPermissionsError("project");
    }

    const requirement = readRequirement(c.req.method, c.req.path);
    if (requirement && !hasRequiredScope(projectApiKey.scopes, requirement)) {
      throw new InsufficientPermissionsError(requirement.scopes.join(" or "));
    }

    await next();
  };
}
