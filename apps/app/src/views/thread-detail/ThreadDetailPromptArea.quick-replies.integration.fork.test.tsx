// @vitest-environment jsdom

import { promptAreaMocks as mocks } from "@/test/thread-detail-prompt-area-harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { makeThreadWithRuntime as makeThread } from "@bb/test-helpers/domain-fixtures";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  ThreadDetailPromptArea,
  type ThreadDetailSentMessageEdit,
} from "./ThreadDetailPromptArea";
import { quickRepliesAtom } from "@/components/promptbox/banner/quick-replies-preference";

describe("quick replies", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.defaultExecutionOptions = null;
    mocks.queuedMessages = [];
    mocks.promptDraft.text = "ordinary draft";
    mocks.promptDraft.mentions = [{ kind: "file", path: "a.ts" }] as never;
    mocks.promptDraft.attachments = [{ path: "a.ts" }] as never;
    mocks.promptDraft.getCurrent.mockImplementation(() => ({
      attachments: mocks.promptDraft.attachments,
      mentions: mocks.promptDraft.mentions,
      text: mocks.promptDraft.text,
    }));
    mocks.sendMessageMutateAsync.mockReset().mockResolvedValue(undefined);
    getDefaultStore().set(quickRepliesAtom, ["first", "line one\nline two"]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    getDefaultStore().set(quickRepliesAtom, []);
  });

  function renderPromptArea({
    environmentGoneStatus = null,
    queuedMessageCount = 0,
    sendPending = false,
    sentMessageEdit,
    thread = makeThread({
      id: "thr_1",
      projectId: "proj_1",
      environmentId: "env_1",
      runtime: { displayStatus: "idle" },
    }),
  }: {
    environmentGoneStatus?: "destroyed" | null;
    queuedMessageCount?: number;
    sendPending?: boolean;
    sentMessageEdit?: ThreadDetailSentMessageEdit;
    thread?: ReturnType<typeof makeThread>;
  } = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <ThreadDetailPromptArea
          activeBackgroundCommands={[]}
          activePromptMode={null}
          activeWorkflows={[]}
          canRestoreEnvironment={false}
          childThreadsSection={null}
          composerFocusRequestKey={0}
          composerId="quick-replies"
          contextEnvironmentId={null}
          environmentGoneStatus={environmentGoneStatus}
          goal={null}
          isPrimaryComposer
          modelFallback={null}
          parentThreadSection={null}
          pendingInteractions={[]}
          pendingTodos={null}
          permissionPolicy="editable"
          projectId="proj_1"
          providerCommands={null}
          queuedMessageCount={queuedMessageCount}
          resolveMentionLink={() => null}
          sendMessage={{
            isPending: sendPending,
            mutateAsync: mocks.sendMessageMutateAsync,
          }}
          sentMessageEdit={sentMessageEdit}
          sessionOptions={null}
          steerActiveThreadOnEnter={false}
          thread={thread}
        />
      </QueryClientProvider>,
    );
  }

  it("sends the selected configured reply without changing the ordinary draft", () => {
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Send “line one\nline two”" }),
    );
    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thr_1",
        input: [{ type: "text", text: "line one\nline two", mentions: [] }],
        mode: "queue-if-active",
      }),
    );
    expect(mocks.promptDraft.getCurrent()).toMatchObject({
      text: "ordinary draft",
    });
  });

  it.each([
    [
      "active",
      makeThread({
        environmentId: "env_1",
        runtime: { displayStatus: "active" },
      }),
    ],
    [
      "pending",
      makeThread({
        environmentId: "env_1",
        runtime: { displayStatus: "pending" },
      }),
    ],
    [
      "waiting-for-host",
      makeThread({
        environmentId: "env_1",
        runtime: { displayStatus: "waiting-for-host" },
      }),
    ],
    ["stopping", makeThread({ environmentId: "env_1", status: "stopping" })],
    [
      "missing environment",
      makeThread({ environmentId: null, runtime: { displayStatus: "idle" } }),
    ],
    [
      "archived",
      makeThread({
        environmentId: "env_1",
        archivedAt: 1,
        runtime: { displayStatus: "idle" },
      }),
    ],
  ])("hides for %s and restores when eligible", (_reason, blockedThread) => {
    const { rerender } = renderPromptArea({ thread: blockedThread });
    expect(screen.queryByRole("button", { name: "Send “first”" })).toBeNull();
    rerender(
      <QueryClientProvider client={queryClient}>
        <ThreadDetailPromptArea
          activeBackgroundCommands={[]}
          activePromptMode={null}
          activeWorkflows={[]}
          canRestoreEnvironment={false}
          childThreadsSection={null}
          composerFocusRequestKey={0}
          composerId="quick-replies"
          contextEnvironmentId={null}
          environmentGoneStatus={null}
          goal={null}
          isPrimaryComposer
          modelFallback={null}
          parentThreadSection={null}
          pendingInteractions={[]}
          pendingTodos={null}
          permissionPolicy="editable"
          projectId="proj_1"
          providerCommands={null}
          queuedMessageCount={0}
          resolveMentionLink={() => null}
          sendMessage={{
            isPending: false,
            mutateAsync: mocks.sendMessageMutateAsync,
          }}
          sessionOptions={null}
          steerActiveThreadOnEnter={false}
          thread={makeThread({
            environmentId: "env_1",
            runtime: { displayStatus: "idle" },
          })}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Send “first”" })).toBeTruthy();
  });

  it("shows for error and hides for gone environments, send pending, and server or loaded queues", () => {
    const errorThread = makeThread({
      environmentId: "env_1",
      runtime: { displayStatus: "error" },
    });
    const mounted = renderPromptArea({ thread: errorThread });
    expect(screen.getByRole("button", { name: "Send “first”" })).toBeTruthy();
    mounted.unmount();
    renderPromptArea({
      thread: errorThread,
      environmentGoneStatus: "destroyed",
    });
    expect(screen.queryByRole("button", { name: "Send “first”" })).toBeNull();
    cleanup();
    renderPromptArea({ thread: errorThread, sendPending: true });
    expect(screen.queryByRole("button", { name: "Send “first”" })).toBeNull();
    cleanup();
    renderPromptArea({ thread: errorThread, queuedMessageCount: 1 });
    expect(screen.queryByRole("button", { name: "Send “first”" })).toBeNull();
    cleanup();
    mocks.queuedMessages = [{ id: "q", threadId: "thr_1" }] as never;
    renderPromptArea({ thread: errorThread });
    expect(screen.queryByRole("button", { name: "Send “first”" })).toBeNull();
  });

  it("suppresses rapid duplicate sends and permits retry after rejection", async () => {
    const first = createDeferredPromise<void>();
    mocks.sendMessageMutateAsync
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    renderPromptArea();
    const button = screen.getByRole("button", { name: "Send “first”" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.reject(new Error("failed"));
    });
    expect(mocks.toastError).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send “first”" }));
    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.promptDraft.getCurrent()).toMatchObject({
      text: "ordinary draft",
    });
  });
});
