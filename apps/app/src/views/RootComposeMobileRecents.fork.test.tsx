// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
import { mobileRecentsCollapsedThreadIdsAtom } from "./mobile-recents-collapse";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { ThreadActionCollectors } from "@/lib/thread-actions/thread-action-registry";

const threadActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => threadActions,
}));

const sdkThreads = vi.hoisted(() => ({
  pin: vi.fn(async ({ threadId }: { threadId: string }) => ({
    id: threadId,
  })),
}));

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));

function TestProviders({
  children,
  store = createStore(),
}: {
  children: ReactNode;
  store?: ReturnType<typeof createStore>;
}) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadActionCollectors
            coreRegistrations={CORE_THREAD_ACTIONS}
            requestRename={() => {}}
          />
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>
  );
}

function storeWithCollapsedThreads(threadIds: string[]) {
  const store = createStore();
  store.set(mobileRecentsCollapsedThreadIdsAtom, threadIds);
  return store;
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_mobile",
    projectId: "proj_mobile",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    status: "active",
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    },
    runtime: {
      displayStatus: "active",
    },
    ...overrides,
  });
}

const IDLE_ACTIVITY: ThreadListEntry["activity"] = {
  activeWorkflowCount: 0,
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activePlanModeCount: 0,
  activeGoalCount: 0,
};

function makeIdleThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThread({
    status: "idle",
    runtime: {
      displayStatus: "idle",
    },
    activity: IDLE_ACTIVITY,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("mobile recents hierarchy interaction", () => {
  const collapsedParentCases: {
    name: string;
    label: string;
    parent?: ThreadListEntry;
    child: ThreadListEntry;
  }[] = [
    {
      name: "child needing plan approval",
      label: "Thread needs plan approval",
      child: makeIdleThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
      }),
    },
    {
      name: "parent and child both awaiting answers",
      label: "Thread is waiting for your answer",
      parent: makeIdleThread({
        id: "thr_parent",
        lastReadAt: 10,
        latestAttentionAt: 5,
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
      }),
      child: makeIdleThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
      }),
    },
    {
      name: "parent question with child plan approval",
      label: "Thread needs user input",
      parent: makeIdleThread({
        id: "thr_parent",
        lastReadAt: 10,
        latestAttentionAt: 5,
        hasPendingInteraction: true,
        pendingInteractionKind: "question",
      }),
      child: makeIdleThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
      }),
    },
  ];

  it.each(collapsedParentCases)(
    "renders $name as $label on a collapsed parent",
    ({ child, parent, label }) => {
      render(
        <TestProviders store={storeWithCollapsedThreads(["thr_parent"])}>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={new Map()}
            providersById={new Map()}
            showCreatingRow={false}
            threads={[
              parent ??
                makeIdleThread({
                  id: "thr_parent",
                  lastReadAt: 10,
                  latestAttentionAt: 5,
                }),
              child,
            ]}
          />
        </TestProviders>,
      );

      expect(screen.getByLabelText(label)).not.toBeNull();
      expect(
        screen.getByRole("link", {
          name: `Open Mobile activity — ${label}`,
        }),
      ).not.toBeNull();
    },
  );
});
