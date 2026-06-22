import type {
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  SabiPlugin,
} from "./types";
import type { GuardrailOptions } from "./guardrails/types";
import type { RagEngine } from "./rag/engine";
import type { SabiPrompts } from "./prompts";

export interface Sabi {
  complete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>>;
  stream(request: StreamRequest): AsyncIterable<StreamChunk>;
  use(plugin: SabiPlugin): void;
  guardrail(name: string, options: GuardrailOptions): void;
  rag: RagEngine;
  prompts: SabiPrompts;
}
