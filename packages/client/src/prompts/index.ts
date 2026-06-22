import { PromptNotFoundError, WeysabiError } from "../errors";
import type { CompleteRequest, CompleteResponse, Message } from "../types";
import { PromptRegistry } from "./registry";
import { Prompt, type PromptDefinition, type PromptMessage } from "./prompt";

export { Prompt, PromptRegistry };
export type { PromptDefinition, PromptMessage };

export interface Prompts {
  register(def: PromptDefinition): void;
  registerMany(defs: PromptDefinition[]): void;
  get(id: string): Prompt | undefined;
  list(): PromptDefinition[];
  remove(id: string): boolean;
  has(id: string): boolean;
  render(id: string, input: Record<string, unknown>): PromptMessage[];
  run<T = unknown>(
    id: string,
    input?: Record<string, unknown>,
    overrides?: Partial<CompleteRequest>
  ): Promise<CompleteResponse<T>>;
  clear(): void;
}

export function createWeysabiPrompts(opts: {
  initialDefinitions?: PromptDefinition[];
  complete: <T>(request: CompleteRequest) => Promise<CompleteResponse<T>>;
}): Prompts {
  const registry = new PromptRegistry();
  const { complete } = opts;

  if (opts.initialDefinitions) {
    registry.registerMany(opts.initialDefinitions);
  }

  return {
    register(def: PromptDefinition): void {
      registry.register(def);
    },

    registerMany(defs: PromptDefinition[]): void {
      registry.registerMany(defs);
    },

    get(id: string): Prompt | undefined {
      return registry.get(id);
    },

    list(): PromptDefinition[] {
      return registry.list();
    },

    remove(id: string): boolean {
      return registry.remove(id);
    },

    has(id: string): boolean {
      return registry.has(id);
    },

    render(id: string, input: Record<string, unknown>): PromptMessage[] {
      return registry.render(id, input);
    },

    async run<T = unknown>(
      id: string,
      input: Record<string, unknown> = {},
      overrides: Partial<CompleteRequest> = {}
    ): Promise<CompleteResponse<T>> {
      const prompt = registry.get(id);
      if (prompt === undefined) throw new PromptNotFoundError(id);

      const messages: Message[] = prompt
        .render(input)
        .map((m) => ({ role: m.role, content: m.content }));

      const def = prompt.definition;
      const model = overrides.model ?? def.model;
      if (!model) {
        throw new WeysabiError(
          `Prompt "${id}" has no default model. Provide model in definition or overrides.`
        );
      }

      const request: CompleteRequest = {
        model,
        messages,
        temperature: overrides.temperature ?? def.temperature,
        maxTokens: overrides.maxTokens ?? def.maxTokens,
        schema: overrides.schema ?? def.schema,
        ...overrides,
      };

      return complete<T>(request);
    },

    clear(): void {
      registry.clear();
    },
  };
}
