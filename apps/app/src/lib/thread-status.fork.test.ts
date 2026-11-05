import type {
  ThreadListEntry,
  ThreadPendingInteractionKind,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from "@bb/domain";
import type {
  PluginSidebarThreadIndicator,
  PluginSidebarThreadRowStatus,
  PluginThreadStatusThread,
} from "@get-bb/plugin-sdk";
import {
  experimental_resolveThreadStatus,
  sharedPendingInteractionKind,
  waitingIndicatorForPendingInteraction,
} from "@get-bb/plugin-sdk/internal/thread-status";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  toPluginSidebarThread,
  toThreadStatusThread,
} from "./plugin-sidebar-threads";

interface ThreadSpec {
  status?: ThreadStatus;
  runtime?: ThreadRuntimeDisplayStatus;
  unread?: boolean;
  parented?: boolean;
  pending?: boolean;
  pendingKind?: ThreadPendingInteractionKind | null;
}

interface StatusCase {
  name: string;
  thread: ThreadSpec | null;
  hidden?: ThreadSpec[];
  rowStatus?: PluginSidebarThreadRowStatus;
  indicator: PluginSidebarThreadIndicator;
  rowStatusShown?: boolean;
  label?: string | null;
  isWorking?: boolean;
}

const ROW_STATUS: PluginSidebarThreadRowStatus = {
  icon: "AiContentGenerator01",
  label: "Plugin improving draft",
};

const RUNNING: ThreadSpec = { status: "active", runtime: "active" };
const UNREAD_ERROR: ThreadSpec = { status: "error", unread: true };

const CASES: StatusCase[] = [
  {
    name: "a pending plan approval",
    thread: { pending: true, pendingKind: "plan_approval" },
    indicator: "waiting-for-plan-approval",
    label: "Thread needs plan approval",
    isWorking: false,
  },
  {
    name: "a pending question",
    thread: { pending: true, pendingKind: "question" },
    indicator: "waiting-for-answer",
    label: "Thread is waiting for your answer",
    isWorking: false,
  },
  {
    name: "a generic pending approval",
    thread: { pending: true, pendingKind: "approval" },
    indicator: "waiting-for-input",
    isWorking: false,
  },
  {
    name: "a pending plan approval over runtime",
    thread: { ...RUNNING, pending: true, pendingKind: "plan_approval" },
    indicator: "waiting-for-plan-approval",
    isWorking: true,
  },
  {
    name: "an unread error over a pending plan approval",
    thread: { ...UNREAD_ERROR, pending: true, pendingKind: "plan_approval" },
    indicator: "unread-error",
    isWorking: false,
  },
  {
    name: "a row status hidden by a pending plan approval",
    thread: { pending: true, pendingKind: "plan_approval" },
    rowStatus: ROW_STATUS,
    indicator: "waiting-for-plan-approval",
    rowStatusShown: false,
    label: "Thread needs plan approval",
  },
  {
    name: "a row status hidden by a pending question",
    thread: { pending: true, pendingKind: "question" },
    rowStatus: ROW_STATUS,
    indicator: "waiting-for-answer",
    rowStatusShown: false,
    label: "Thread is waiting for your answer",
  },
  {
    name: "a collapsed parent whose descendants share a pending plan approval",
    thread: {},
    hidden: [
      { parented: true, pending: true, pendingKind: "plan_approval" },
      { parented: true, pending: true, pendingKind: "plan_approval" },
    ],
    indicator: "waiting-for-plan-approval",
    isWorking: false,
  },
  {
    name: "a collapsed parent whose descendants disagree on the pending kind",
    thread: {},
    hidden: [
      { parented: true, pending: true, pendingKind: "plan_approval" },
      { parented: true, pending: true, pendingKind: "question" },
    ],
    indicator: "waiting-for-input",
    isWorking: false,
  },
  {
    name: "a collapsed parent keeping its own pending kind over idle descendants",
    thread: { pending: true, pendingKind: "question" },
    hidden: [{ parented: true }],
    indicator: "waiting-for-answer",
    isWorking: false,
  },
  {
    name: "a collapsed parent sharing its descendants' pending question",
    thread: { pending: true, pendingKind: "question" },
    hidden: [{ parented: true, pending: true, pendingKind: "question" }],
    indicator: "waiting-for-answer",
    isWorking: false,
  },
  {
    name: "a collapsed parent whose pending kind disagrees with a descendant's",
    thread: { pending: true, pendingKind: "plan_approval" },
    hidden: [{ parented: true, pending: true, pendingKind: "question" }],
    indicator: "waiting-for-input",
    isWorking: false,
  },
  {
    name: "a pending question parent ignoring a non-pending hidden sibling of another kind",
    thread: { pending: true, pendingKind: "question" },
    hidden: [{ parented: true, pendingKind: "plan_approval" }],
    indicator: "waiting-for-answer",
    isWorking: false,
  },
  {
    name: "a collapsed group of two pending plan approvals",
    thread: null,
    hidden: [
      { parented: true, pending: true, pendingKind: "plan_approval" },
      { parented: true, pending: true, pendingKind: "plan_approval" },
    ],
    indicator: "waiting-for-plan-approval",
    isWorking: false,
  },
  {
    name: "a pending plan approval parent sharing a pending hidden thread and ignoring a non-pending one",
    thread: { pending: true, pendingKind: "plan_approval" },
    hidden: [
      { parented: true, pending: true, pendingKind: "plan_approval" },
      { parented: true, pendingKind: null },
    ],
    indicator: "waiting-for-plan-approval",
    isWorking: false,
  },
];

let nextId = 0;

function toEntry(spec: ThreadSpec): ThreadListEntry {
  nextId += 1;
  return makeThreadListEntry({
    id: `thr_${nextId}`,
    projectId: "proj_1",
    status: spec.status ?? "idle",
    runtime: { displayStatus: spec.runtime ?? "idle" },
    lastReadAt: spec.unread ? 1 : 2,
    latestAttentionAt: 2,
    parentThreadId: spec.parented ? "thr_parent" : null,
    hasPendingInteraction: spec.pending ?? false,
    pendingInteractionKind: spec.pendingKind ?? null,
  });
}

const CALLERS: {
  name: string;
  toThread: (entry: ThreadListEntry) => PluginThreadStatusThread;
}[] = [
  { name: "core lists", toThread: toThreadStatusThread },
  {
    name: "the thread-list plugin",
    toThread: (entry) => toPluginSidebarThread(entry),
  },
];

describe("experimental_resolveThreadStatus", () => {
  describe.each(CALLERS)("through $name", ({ toThread }) => {
    it.each(CASES)("resolves $name", (testCase) => {
      const status = experimental_resolveThreadStatus({
        thread:
          testCase.thread === null ? null : toThread(toEntry(testCase.thread)),
        hiddenThreads: (testCase.hidden ?? []).map((spec) =>
          toThread(toEntry(spec)),
        ),
        hasUnsubmittedDraft: false,
        rowStatus: testCase.rowStatus ?? null,
      });

      expect(status.indicator).toBe(testCase.indicator);
      if (testCase.rowStatusShown !== undefined) {
        expect(status.rowStatus).toBe(
          testCase.rowStatusShown ? testCase.rowStatus : null,
        );
      }
      if (testCase.label !== undefined) {
        expect(status.label).toBe(testCase.label);
      }
      if (testCase.isWorking !== undefined) {
        expect(status.isWorking).toBe(testCase.isWorking);
      }
    });

    it("falls back to the generic waiting indicator on an unknown pending kind", () => {
      const status = experimental_resolveThreadStatus({
        thread: toThread({
          ...toEntry({ pending: true }),
          pendingInteractionKind:
            "mystery" as string as ThreadPendingInteractionKind,
        }),
        hiddenThreads: [],
        hasUnsubmittedDraft: false,
        rowStatus: null,
      });

      expect(status.indicator).toBe("waiting-for-input");
    });

    it("falls back to the generic waiting indicator when a hidden thread omits the pending kind", () => {
      const { pendingInteractionKind: _omittedKind, ...hiddenThread } =
        toThread(toEntry({ pending: true, pendingKind: "plan_approval" }));
      const status = experimental_resolveThreadStatus({
        thread: toThread(
          toEntry({ pending: true, pendingKind: "plan_approval" }),
        ),
        hiddenThreads: [hiddenThread as PluginThreadStatusThread],
        hasUnsubmittedDraft: false,
        rowStatus: null,
      });

      expect(status.indicator).toBe("waiting-for-input");
    });

    it("falls back to the generic waiting indicator for a pending thread with a null kind and a hidden thread omitting it", () => {
      const { pendingInteractionKind: _omittedKind, ...hiddenThread } =
        toThread(toEntry({ pending: true, pendingKind: "plan_approval" }));
      const status = experimental_resolveThreadStatus({
        thread: toThread(toEntry({ pending: true, pendingKind: null })),
        hiddenThreads: [hiddenThread as PluginThreadStatusThread],
        hasUnsubmittedDraft: false,
        rowStatus: null,
      });

      expect(status.indicator).toBe("waiting-for-input");
    });
  });
});

describe("waitingIndicatorForPendingInteraction", () => {
  it.each([
    ["plan_approval", "waiting-for-plan-approval"],
    ["question", "waiting-for-answer"],
    ["approval", "waiting-for-input"],
    [null, "waiting-for-input"],
  ] as const)("maps %s to %s", (kind, indicator) => {
    expect(waitingIndicatorForPendingInteraction(kind)).toBe(indicator);
  });
});

describe("sharedPendingInteractionKind", () => {
  it("returns null without waiting sources", () => {
    expect(sharedPendingInteractionKind([])).toBeNull();
  });

  it("returns the kind when every waiting source shares it", () => {
    expect(
      sharedPendingInteractionKind(["plan_approval", "plan_approval"]),
    ).toBe("plan_approval");
    expect(sharedPendingInteractionKind(["question"])).toBe("question");
  });

  it("returns null when the waiting sources disagree, in either order", () => {
    expect(
      sharedPendingInteractionKind(["plan_approval", "question"]),
    ).toBeNull();
    expect(
      sharedPendingInteractionKind(["question", "plan_approval"]),
    ).toBeNull();
  });

  it("treats a missing kind as its own generic kind", () => {
    expect(sharedPendingInteractionKind([null, null])).toBeNull();
    expect(sharedPendingInteractionKind(["plan_approval", null])).toBeNull();
    expect(sharedPendingInteractionKind([null, "plan_approval"])).toBeNull();
  });
});
