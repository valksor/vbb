import { describe, expect, it } from "vitest";
import { createClaudeDeltaHarness, loadFixture } from "./delta-test-harness.js";

describe("claude unhandled and ignored events", () => {
  it("fixture: system-init reports the model the session runs (get-bb/bb#1787)", () => {
    const harness = createClaudeDeltaHarness();
    const events = harness.translate(loadFixture("system-init.json"));
    expect(events).toMatchObject([
      {
        type: "thread/execution/reported",
        scope: { kind: "thread" },
        execution: {
          model: "claude-sonnet-4-6",
          reasoningLevel: null,
          permissionMode: null,
          serviceTier: null,
        },
      },
    ]);
  });

  it("maps an init's permission mode, effort and fast mode into bb's vocabulary", () => {
    const harness = createClaudeDeltaHarness();
    const events = harness.translate({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "claude-opus-5",
      permissionMode: "bypassPermissions",
      effort: "xhigh",
      fast_mode_state: "on",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "thread/execution/reported",
        execution: {
          model: "claude-opus-5",
          reasoningLevel: "xhigh",
          permissionMode: "full",
          serviceTier: "fast",
        },
      }),
    ]);
  });
});
