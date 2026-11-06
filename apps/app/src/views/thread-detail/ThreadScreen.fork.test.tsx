// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { PendingInteraction, ThreadListEntry } from "@bb/domain";
import type { UseThreadTimelineControllerResult } from "@/components/thread/timeline";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { ThreadScreen, type ThreadScreenPresentation } from "./ThreadScreen";

const mocks = vi.hoisted(() => ({
  childThreads: [] as ThreadListEntry[],
  pendingInteractions: [] as PendingInteraction[],
  promptAreaProps: [] as Array<Record<string, unknown>>,
  surfaceProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useChildThreads: () => ({ data: mocks.childThreads }),
  useThread: () => ({ data: undefined }),
  useThreadPendingInteractions: () => ({ data: mocks.pendingInteractions }),
}));

vi.mock("@/hooks/queries/child-thread-pending-interactions", () => ({
  useChildThreadPendingAttention: () => [],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    useEditThreadMessage: mutation,
    useSendThreadMessage: mutation,
  };
});

vi.mock("@/components/thread/timeline", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/thread/timeline")>();
  return {
    ...actual,
    ThreadTimelineSurface: (props: Record<string, unknown>) => {
      mocks.surfaceProps.push(props);
      const addToChat = props.onSelectionAddToChat as
        | ((text: string) => void)
        | undefined;
      return (
        <button type="button" onClick={() => addToChat?.("Quoted line")}>
          Add selection to chat
        </button>
      );
    },
  };
});

vi.mock("./ThreadDetailPromptArea", () => ({
  ThreadDetailPromptArea: (props: Record<string, unknown>) => {
    mocks.promptAreaProps.push(props);
    return <div data-testid="prompt-area" />;
  },
}));

const THREAD = makeThreadResponse({
  id: "thr_screen",
  projectId: "proj_screen",
  status: "active",
  runtime: { displayStatus: "active" },
});

const TIMELINE = {
  activeBackgroundCommands: [],
  activePromptMode: null,
  activeThinking: null,
  activeWorkflows: [],
  contextBoundarySeq: null,
  contextWindowUsage: null,
  goal: null,
  hasOlderTimelineRows: false,
  isCatchingUpTimeline: false,
  isLoadingOlderTimelineRows: false,
  loadOlderTimelineRows: async () => {},
  modelFallback: null,
  pendingTodos: null,
  providerCommands: null,
  sessionOptions: null,
  timelineError: null,
  timelineLoading: false,
  timelineRows: [],
} as unknown as UseThreadTimelineControllerResult;

function renderScreen(
  presentation: ThreadScreenPresentation,
  composer: ComponentProps<typeof ThreadScreen>["composer"] = {
    environmentCheckout: undefined,
    environmentChrome: undefined,
    contextEnvironmentId: null,
    permissionPolicy: "snapshot",
  },
) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <ThreadScreen
        composer={composer}
        environment={null}
        presentation={presentation}
        projectId={THREAD.projectId}
        resolveMentionLink={() => null}
        thread={THREAD}
        timeline={TIMELINE}
        timelineHost={{
          environmentHostName: null,
          includePluginMessageActions: false,
          unreadDividerAutoScroll: false,
          unreadDividerPlacement: null,
        }}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  mocks.childThreads = [];
  mocks.pendingInteractions = [];
  mocks.promptAreaProps = [];
  mocks.surfaceProps = [];
});

afterEach(() => {
  cleanup();
  getPromptDraftAccessor({
    kind: "thread",
    projectId: THREAD.projectId,
    threadId: THREAD.id,
  }).setDraft({ text: "", mentions: [], attachments: [] });
});

describe("ThreadScreen fork coverage", () => {
  it("renders the aside only with an open composer", () => {
    const composer = {
      environmentCheckout: undefined,
      environmentChrome: undefined,
      contextEnvironmentId: null,
      permissionPolicy: "snapshot" as const,
      aside: (
        <aside aria-label="Composer aside">
          aside for {THREAD.id}/{THREAD.projectId}
        </aside>
      ),
    };
    const open = renderScreen({ kind: "page" }, composer);

    expect(screen.queryByTestId("prompt-area")).not.toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Composer aside" }).textContent,
    ).toBe(`aside for ${THREAD.id}/${THREAD.projectId}`);

    open.unmount();
    renderScreen({ kind: "page" }, null);

    expect(screen.queryByTestId("prompt-area")).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Composer aside" }),
    ).toBeNull();
  });

  it("passes a child waiting kind to the child threads section", () => {
    mocks.childThreads = [
      makeThreadListEntry({
        id: "thr_child",
        projectId: THREAD.projectId,
        hasPendingInteraction: true,
        pendingInteractionKind: "plan_approval",
      }),
    ];
    renderScreen({ kind: "page" });

    expect(mocks.promptAreaProps.at(-1)!.childThreadsSection).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: "thr_child",
            pendingInteractionKind: "plan_approval",
          }),
        ],
      }),
    );
  });
});
