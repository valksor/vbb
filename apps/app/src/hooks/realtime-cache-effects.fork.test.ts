import type { ThreadPendingInteractionKind } from "@bb/domain";
import {
  projectPromptHistoryQueryKey,
  sidebarNavigationQueryKey,
  terminalsQueryKey,
  threadListQueryKey,
} from "./queries/query-keys";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  createRealtimeCacheEffects,
  type RealtimeCacheEffectsVisibility,
} from "./realtime-cache-effects";

interface CachedThreadListEntryFixture {
  hasPendingInteraction: boolean;
  id: string;
  pendingInteractionKind?: ThreadPendingInteractionKind | null;
}

interface CachedSidebarNavigationProjectFixture {
  threads: CachedThreadListEntryFixture[];
}

interface CachedSidebarNavigationFixture {
  personalProject: CachedSidebarNavigationProjectFixture;
  projects: CachedSidebarNavigationProjectFixture[];
}

function createRealtimeEffectsTestContext(
  visibility?: RealtimeCacheEffectsVisibility,
  refreshSidebarWhileHidden?: boolean,
) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
  const effects = createRealtimeCacheEffects({
    queryClient,
    refreshSidebarWhileHidden,
    visibility,
  });
  const firstProjectHistoryKey = projectPromptHistoryQueryKey("project-1");
  const secondProjectHistoryKey = projectPromptHistoryQueryKey("project-2");
  const terminalKey = terminalsQueryKey({
    kind: "thread",
    threadId: "thr_1",
  });

  queryClient.setQueryData(firstProjectHistoryKey, []);
  queryClient.setQueryData(secondProjectHistoryKey, []);
  queryClient.setQueryData(terminalKey, { sessions: [] });

  return {
    effects,
    firstProjectHistoryKey,
    queryClient,
    secondProjectHistoryKey,
    terminalKey,
  };
}

describe("createRealtimeCacheEffects", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces a stale pending interaction kind when a new interaction reports none", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData<CachedThreadListEntryFixture[]>(threadListKey, [
      {
        hasPendingInteraction: false,
        id: "thr_1",
        pendingInteractionKind: null,
      },
    ]);
    queryClient.setQueryData<CachedSidebarNavigationFixture>(
      sidebarNavigationKey,
      {
        projects: [
          {
            threads: [
              {
                hasPendingInteraction: false,
                id: "thr_1",
                pendingInteractionKind: null,
              },
            ],
          },
        ],
        personalProject: { threads: [] },
      },
    );

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
        projectId: "project-1",
      },
      changes: ["interactions-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(
      queryClient
        .getQueryData<CachedThreadListEntryFixture[]>(threadListKey)
        ?.at(0)?.pendingInteractionKind,
    ).toBe("plan_approval");

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        hasPendingInteraction: false,
        pendingInteractionKind: null,
        projectId: "project-1",
      },
      changes: ["interactions-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(
      queryClient
        .getQueryData<CachedThreadListEntryFixture[]>(threadListKey)
        ?.at(0)?.hasPendingInteraction,
    ).toBe(false);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        hasPendingInteraction: true,
        projectId: "project-1",
      },
      changes: ["interactions-changed"],
    });
    vi.advanceTimersByTime(50);

    const entry = queryClient
      .getQueryData<CachedThreadListEntryFixture[]>(threadListKey)
      ?.at(0);
    expect(entry?.hasPendingInteraction).toBe(true);
    expect(entry?.pendingInteractionKind).toBe(null);
    expect(
      queryClient
        .getQueryData<CachedSidebarNavigationFixture>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0),
    ).toMatchObject({
      hasPendingInteraction: true,
      pendingInteractionKind: null,
    });

    effects.dispose();
  });
});
