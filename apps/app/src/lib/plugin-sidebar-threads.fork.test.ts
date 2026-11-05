import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { toPluginSidebarThread } from "./plugin-sidebar-threads";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: "A thread",
    lastReadAt: 10,
    latestAttentionAt: 5,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

describe("toPluginSidebarThread", () => {
  it("resolves a pending plan approval into its own waiting indicator", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
      }),
    );
    expect(mapped.indicator).toBe("waiting-for-plan-approval");
    expect(mapped.indicatorLabel).toBe("Thread needs plan approval");
    expect(mapped.hasPendingInteraction).toBe(true);
  });

  it("resolves a pending question into the answer waiting indicator", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
      }),
    );
    expect(mapped.indicator).toBe("waiting-for-answer");
    expect(mapped.indicatorLabel).toBe("Thread is waiting for your answer");
  });

  it("keeps a generic approval on the shared waiting indicator", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        hasPendingInteraction: true,
        pendingInteractionKind: "approval",
      }),
    );
    expect(mapped.indicator).toBe("waiting-for-input");
    expect(mapped.indicatorLabel).toBe("Thread needs user input");
  });
});
