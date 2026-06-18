import type { ProviderHandler } from "./handler";
import { openaiHandler } from "./openai";

export const mistralHandler: ProviderHandler = openaiHandler;
