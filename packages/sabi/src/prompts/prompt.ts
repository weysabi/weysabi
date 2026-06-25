import { z } from "zod";
import { MissingPromptInputError } from "../errors";

const TEMPLATE_REGEX = /\{(\w+)\}/g;

export const PromptMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type PromptMessage = z.infer<typeof PromptMessageSchema>;

export const PromptDefinitionSchema = z.object({
  id: z.string().min(1),
  messages: z.array(PromptMessageSchema).min(1),
  schema: z.any().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
});
export type PromptDefinition = z.input<typeof PromptDefinitionSchema>;

export class Prompt {
  private def: PromptDefinition;

  constructor(def: PromptDefinition) {
    this.def = PromptDefinitionSchema.parse(def);
  }

  get id(): string {
    return this.def.id;
  }

  get definition(): PromptDefinition {
    return { ...this.def };
  }

  get model(): string | undefined {
    return this.def.model;
  }

  render(input: Record<string, unknown>): PromptMessage[] {
    return this.def.messages.map((msg) => ({
      role: msg.role,
      content: msg.content.replace(TEMPLATE_REGEX, (_match, key: string) => {
        if (!(key in input)) {
          throw new MissingPromptInputError(key, this.def.id);
        }
        return String(input[key]);
      }),
    }));
  }
}
