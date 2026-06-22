import { PromptNotFoundError } from "../errors";
import { Prompt, type PromptDefinition } from "./prompt";

export class PromptRegistry {
  private prompts = new Map<string, Prompt>();

  register(def: PromptDefinition): void {
    const prompt = new Prompt(def);
    this.prompts.set(def.id, prompt);
  }

  registerMany(defs: PromptDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  get(id: string): Prompt | undefined {
    return this.prompts.get(id);
  }

  list(): PromptDefinition[] {
    return Array.from(this.prompts.values()).map((p) => p.definition);
  }

  remove(id: string): boolean {
    return this.prompts.delete(id);
  }

  has(id: string): boolean {
    return this.prompts.has(id);
  }

  render(id: string, input: Record<string, unknown>): ReturnType<Prompt["render"]> {
    const prompt = this.prompts.get(id);
    if (prompt === undefined) throw new PromptNotFoundError(id);
    return prompt.render(input);
  }

  clear(): void {
    this.prompts.clear();
  }
}
