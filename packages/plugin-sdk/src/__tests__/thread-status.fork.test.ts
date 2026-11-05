import { describe, expect, it } from "vitest";
import type { PluginThreadStatusThread } from "../app-contract.js";
import { refinePendingIndicator } from "../internal/thread-status.fork.js";

function makeThread(
  overrides: Partial<PluginThreadStatusThread>,
): PluginThreadStatusThread {
  return {
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    pendingInteractionKind: null,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    isUnread: false,
    parentThreadId: null,
    ...overrides,
  };
}

describe("refinePendingIndicator", () => {
  it("keeps the generic waiting indicator without a row thread or hidden threads", () => {
    expect(refinePendingIndicator("waiting-for-input", null, [])).toBe(
      "waiting-for-input",
    );
  });

  it("ignores a thread that is not pending, whatever its kind", () => {
    const thread = makeThread({
      hasPendingInteraction: false,
      pendingInteractionKind: "plan_approval",
    });

    expect(refinePendingIndicator("waiting-for-input", thread, [])).toBe(
      "waiting-for-input",
    );
  });

  it("leaves an indicator other than waiting-for-input untouched", () => {
    const thread = makeThread({
      hasPendingInteraction: true,
      pendingInteractionKind: "plan_approval",
    });

    expect(refinePendingIndicator("runtime", thread, [])).toBe("runtime");
  });

  it("refines a pending question to the answer indicator", () => {
    const thread = makeThread({
      hasPendingInteraction: true,
      pendingInteractionKind: "question",
    });

    expect(refinePendingIndicator("waiting-for-input", thread, [])).toBe(
      "waiting-for-answer",
    );
  });
});
