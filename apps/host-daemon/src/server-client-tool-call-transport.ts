import { Agent } from "undici";

export const TOOL_CALL_TIMEOUT_MS = 65 * 60 * 1000;

export const toolCallDispatcher = new Agent({
  headersTimeout: TOOL_CALL_TIMEOUT_MS,
  bodyTimeout: TOOL_CALL_TIMEOUT_MS,
});
