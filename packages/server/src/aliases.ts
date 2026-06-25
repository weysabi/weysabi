import { ModelAliasCycleError } from "./errors";

export interface ModelAlias {
  alias: string;
  model: string;
}

export type ModelAliasMap = Map<string, string>;

export function buildModelAliases(config?: ModelAlias[], env?: string): ModelAliasMap {
  const map: ModelAliasMap = new Map();

  const envStr = env ?? process.env.SABI_MODEL_ALIASES;
  if (envStr) {
    for (const pair of envStr.split(",")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const alias = pair.slice(0, eqIdx).trim();
      const model = pair.slice(eqIdx + 1).trim();
      if (alias && model) {
        map.set(alias, model);
      }
    }
  }

  if (config) {
    for (const entry of config) {
      map.set(entry.alias, entry.model);
    }
  }

  return map;
}

export function resolveAlias(aliases: ModelAliasMap, model: string): string {
  const visited = new Set<string>();
  let resolved = model;

  while (aliases.has(resolved)) {
    if (visited.has(resolved)) {
      throw new ModelAliasCycleError(resolved);
    }
    visited.add(resolved);
    resolved = aliases.get(resolved)!;
  }

  return resolved;
}

export function getAliasesList(aliases: ModelAliasMap): ModelAlias[] {
  return [...aliases.entries()].map(([alias, model]) => ({ alias, model }));
}
