import type {
  CompleteRequest,
  CompleteResponse,
  StreamRequest,
  StreamChunk,
  Plugin,
} from "./types";
import type { GuardrailOptions } from "./guardrails/types";
import type { RagEngine } from "./rag/engine";
import type { Prompts } from "./prompts";

export interface Weysabi {
  complete<T = unknown>(request: CompleteRequest): Promise<CompleteResponse<T>>;
  stream(request: StreamRequest): AsyncIterable<StreamChunk>;
  use(plugin: Plugin): void;
  guardrail(name: string, options: GuardrailOptions): void;
  rag: RagEngine;
  prompts: Prompts;
  close?(): void;
}
