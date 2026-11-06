import type { ThreadEvent } from "@bb/domain";
import { threadScope } from "@bb/domain";
import type { ThreadDelta } from "../thread-delta.js";

export function executionReportedEvent(
  delta: Extract<ThreadDelta, { kind: "thread.execution" }>,
  threadId: string,
): ThreadEvent {
  return {
    type: "thread/execution/reported",
    threadId,
    providerThreadId: "",
    scope: threadScope(),
    execution: { ...delta.execution },
  };
}
