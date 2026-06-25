import { z } from "zod";

export const PiiCategorySchema = z.enum([
  "email",
  "phone",
  "ssn",
  "credit_card",
  "api_key",
  "ip",
  "custom",
]);
export type PiiCategory = z.infer<typeof PiiCategorySchema>;

export const GuardrailActionSchema = z.enum(["block", "redact", "warn", "passthrough"]);
export type GuardrailAction = z.infer<typeof GuardrailActionSchema>;

export const PiiRuleSchema = z.object({
  action: GuardrailActionSchema,
  pattern: z.string().optional(),
});
export type PiiRule = z.infer<typeof PiiRuleSchema>;

export const InjectionConfigSchema = z.object({
  block: z.boolean().default(true),
  threshold: z.number().min(0).max(1).optional().default(0.5),
});
export type InjectionConfig = z.infer<typeof InjectionConfigSchema>;

export const ContentCategorySchema = z.enum([
  "hate",
  "harassment",
  "violence",
  "sexual",
  "self_harm",
]);
export type ContentCategory = z.infer<typeof ContentCategorySchema>;

export const ContentRuleSchema = z.object({
  action: GuardrailActionSchema.default("block"),
});
export type ContentRule = z.infer<typeof ContentRuleSchema>;

export const TokenLimitActionSchema = z.enum(["block", "warn", "truncate"]);
export type TokenLimitAction = z.infer<typeof TokenLimitActionSchema>;

export const TokenLimitConfigSchema = z.object({
  maxTokens: z.number().int().positive(),
  action: TokenLimitActionSchema.default("block"),
});
export type TokenLimitConfig = z.infer<typeof TokenLimitConfigSchema>;

export const GuardrailsInputConfigSchema = z.object({
  pii: z.record(z.string(), PiiRuleSchema).optional(),
  injection: InjectionConfigSchema.optional(),
  content: z.record(z.string(), ContentRuleSchema).optional(),
});
export type GuardrailsInputConfig = z.infer<typeof GuardrailsInputConfigSchema>;

export const GuardrailsOutputConfigSchema = z.object({
  pii: z.record(z.string(), PiiRuleSchema).optional(),
  content: z.record(z.string(), ContentRuleSchema).optional(),
  tokenLimit: TokenLimitConfigSchema.optional(),
});
export type GuardrailsOutputConfig = z.infer<typeof GuardrailsOutputConfigSchema>;

export const GuardrailsConfigSchema = z.object({
  name: z.string().optional().default("guardrails"),
  input: GuardrailsInputConfigSchema.optional(),
  output: GuardrailsOutputConfigSchema.optional(),
  moderationApiKey: z.string().optional(),
});
export type GuardrailsConfig = z.input<typeof GuardrailsConfigSchema>;

export interface GuardrailMatch {
  category: string;
  subcategory: string;
  action: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GuardrailOptions {
  scope: "input" | "output" | "both";
  validate: (text: string) => { passed: boolean; message?: string } | boolean;
  onViolation?: (match: GuardrailMatch) => void;
}
