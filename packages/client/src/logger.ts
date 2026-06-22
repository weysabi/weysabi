import createCatalog from "@joinremba/catalog";
import type { Catalog } from "@joinremba/catalog";

export const log: Catalog = createCatalog({
  service: "sabi",
  level: "info",
});

export const createModuleLogger = (name: string): Catalog => log.child({ module: name });
