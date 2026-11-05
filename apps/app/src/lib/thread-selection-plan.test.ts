import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import {
  isArchiveRunningStatus,
  selectionStopsRunningWork,
  summarizeThreadSelection,
} from "./thread-selection-plan";

describe("summarizeThreadSelection", () => {
  it("acts on the topmost selected threads and counts only unselected descendants once", () => {
    const parent = makeThread({ id: "parent" });
    const child = makeThread({ id: "child", parentThreadId: "parent" });
    const grandchild = makeThread({
      id: "grandchild",
      parentThreadId: "middle",
    });
    const other = makeThread({ id: "other" });
    const plan = summarizeThreadSelection(
      [parent, child, grandchild, other],
      [
        {
          threadId: "parent",
          cascadeThreadIds: ["child", "middle", "grandchild", "leaf"],
        },
        { threadId: "child", cascadeThreadIds: [] },
        { threadId: "grandchild", cascadeThreadIds: ["leaf"] },
        { threadId: "other", cascadeThreadIds: ["other-child"] },
      ],
    );
    expect(plan.roots.map((thread) => thread.id)).toEqual(["parent", "other"]);
    expect(plan.childThreadCount).toBe(3);
    expect(plan.cascadeThreadIdsByRootId.get("other")).toEqual(["other-child"]);
  });
});

describe("isArchiveRunningStatus", () => {
  it.each(["starting", "active", "stopping"] as const)(
    "treats a %s thread as running",
    (status) => {
      expect(isArchiveRunningStatus(status)).toBe(true);
    },
  );

  it("treats an idle thread as not running", () => {
    expect(isArchiveRunningStatus("idle")).toBe(false);
  });
});

describe("selectionStopsRunningWork", () => {
  it("counts a selected running thread as stopping work even with an empty cache", () => {
    const running = makeThread({ status: "active" });
    expect(
      selectionStopsRunningWork(new QueryClient(), [running], {
        roots: [running],
        cascadeThreadIdsByRootId: new Map(),
        childThreadCount: 0,
      }),
    ).toBe(true);
  });

  it("counts a cascade id missing from the cache as not running", () => {
    const parent = makeThread();
    const plan = summarizeThreadSelection(
      [parent],
      [{ threadId: parent.id, cascadeThreadIds: ["thr_ghost"] }],
    );
    expect(selectionStopsRunningWork(new QueryClient(), [parent], plan)).toBe(
      false,
    );
  });

  it("counts a cached archived cascade thread as not running", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      threadQueryKey("thr_archived_child"),
      makeThread({
        id: "thr_archived_child",
        status: "stopping",
        archivedAt: 5,
      }),
    );
    const parent = makeThread();
    const plan = summarizeThreadSelection(
      [parent],
      [{ threadId: parent.id, cascadeThreadIds: ["thr_archived_child"] }],
    );
    expect(selectionStopsRunningWork(queryClient, [parent], plan)).toBe(false);
  });

  it("counts a cached live cascade thread as running", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      threadQueryKey("thr_live_child"),
      makeThread({
        id: "thr_live_child",
        status: "active",
        archivedAt: null,
      }),
    );
    const parent = makeThread();
    const plan = summarizeThreadSelection(
      [parent],
      [{ threadId: parent.id, cascadeThreadIds: ["thr_live_child"] }],
    );
    expect(selectionStopsRunningWork(queryClient, [parent], plan)).toBe(true);
  });
});
