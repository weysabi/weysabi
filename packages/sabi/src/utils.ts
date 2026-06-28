export function parseModel(full: string): { provider: string; modelId: string } {
  const slashIndex = full.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model format "${full}" — expected "provider/model" (e.g. "groq/llama-3.1-8b-instant")`
    );
  }
  return {
    provider: full.slice(0, slashIndex),
    modelId: full.slice(slashIndex + 1),
  };
}

export function generateId(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i]! % chars.length];
  }
  return result;
}

export function tryParseJSON<T = Record<string, unknown>>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface ZodSchema {
  description?: string;
  _def: {
    type: string;
    shape?: Record<string, ZodSchema>;
    entries?: Record<string, string>;
    options?: string[];
    innerType?: ZodSchema;
    element?: ZodSchema;
  };
}

export function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) {
    return {};
  }
  const z = schema as ZodSchema;
  const def = z._def;
  if (!def || !def.type) return {};

  const base: Record<string, unknown> = {};
  if (z.description) base.description = z.description;

  switch (def.type) {
    case "string":
      return { ...base, type: "string" };
    case "number":
      return { ...base, type: "number" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "array": {
      const inner = def.innerType ?? def.element;
      return { ...base, type: "array", items: inner ? zodToJsonSchema(inner) : {} };
    }
    case "object": {
      const shape = def.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(field);
        const fieldDef = field._def;
        if (
          fieldDef.type !== "optional" &&
          fieldDef.type !== "null" &&
          fieldDef.type !== "nullish"
        ) {
          required.push(key);
        }
      }
      return { ...base, type: "object", properties, ...(required.length > 0 ? { required } : {}) };
    }
    case "enum": {
      const values = def.options ?? Object.keys(def.entries ?? {});
      return { ...base, type: "string", enum: values };
    }
    case "optional":
    case "null":
    case "nullish": {
      const inner = def.innerType;
      if (inner) return zodToJsonSchema(inner);
      return { ...base };
    }
    default:
      return { ...base, type: "string" };
  }
}
