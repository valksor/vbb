import { describe, expect, it } from "vitest";
import { createDeltaAssembler } from "./delta-assembler.js";

const execution = {
  model: "claude-opus-4-6",
  reasoningLevel: "high",
  permissionMode: "accept-edits" as const,
  serviceTier: "default",
};

describe("execution report assembly", () => {
  it("keeps reports thread scoped without changing turn or output ordering", () => {
    const assembler = createDeltaAssembler({
      providerId: "claude-code",
      entropyPrefix: "execution-report",
      textDeltaFlushMs: 0,
    });

    expect(
      assembler.assemble({
        threadId: "thr_1",
        deltas: [{ kind: "thread.execution", execution }],
      }),
    ).toEqual([
      expect.objectContaining({
        type: "thread/execution/reported",
        threadId: "",
        providerThreadId: "",
        scope: { kind: "thread" },
        execution,
      }),
    ]);

    const beforeTurn = assembler.assemble({
      threadId: "thr_1",
      deltas: [{ kind: "thread.execution", execution }],
    });
    expect(beforeTurn.map((event) => event.type)).toEqual([
      "thread/execution/reported",
    ]);

    const duringTurn = assembler.assemble({
      threadId: "thr_1",
      deltas: [
        { kind: "turn.open" },
        {
          kind: "item.open",
          key: { providerItemId: "message-1" },
          item: { type: "agentMessage", text: "" },
        },
        {
          kind: "item.textDelta",
          key: { providerItemId: "message-1" },
          channel: "agentMessage",
          text: "hello",
        },
        { kind: "thread.execution", execution },
      ],
    });
    expect(duringTurn.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
      "item/agentMessage/delta",
      "thread/execution/reported",
    ]);

    const afterTurn = assembler.assemble({
      threadId: "thr_1",
      deltas: [
        { kind: "turn.boundary", status: "completed" },
        { kind: "thread.execution", execution },
      ],
    });
    expect(afterTurn.map((event) => event.type)).toEqual([
      "turn/completed",
      "thread/execution/reported",
    ]);
  });
});
