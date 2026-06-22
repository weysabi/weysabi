import type { GuardrailMatch } from "./types";

export class GuardrailError extends Error {
  public readonly category: string;
  public readonly subcategory: string;
  public readonly action: string;
  public readonly details?: Record<string, unknown>;

  constructor(match: GuardrailMatch) {
    super(match.message);
    this.name = "GuardrailError";
    this.category = match.category;
    this.subcategory = match.subcategory;
    this.action = match.action;
    this.details = match.details;
  }
}
