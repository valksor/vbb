import { describe, expect, it } from "vitest";
import { createClaudeDeltaHarness } from "./delta-test-harness.js";

describe("claude tool-result translation (delta path)", () => {
  it("records a replayed sdk/user row with string content as unhandled (thread thr_ijhpz5srpe seq 2069, 2026-10-26)", () => {
    const harness = createClaudeDeltaHarness();

    const events = harness.translate(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          message: {
            type: "user",
            message: {
              role: "user",
              content:
                "[bb auto-review] steered user message delivered as a plain string",
            },
            session_id: "b1189688-7a83-4bcd-9574-b88701cc2a98",
            parent_tool_use_id: null,
            uuid: "939faa18-eb79-4a6f-8925-c43488aa0b96",
            timestamp: "2026-10-26T12:12:10.037Z",
            isReplay: true,
          },
          threadId: "thr_ijhpz5srpe",
        },
      },
      { threadId: "thr_ijhpz5srpe" },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
        rawType: "sdk/user",
        scope: { kind: "thread" },
        rawEvent: expect.objectContaining({
          method: "sdk/message",
          params: expect.objectContaining({
            message: expect.objectContaining({ isReplay: true }),
          }),
        }),
      }),
    );
  });
});
