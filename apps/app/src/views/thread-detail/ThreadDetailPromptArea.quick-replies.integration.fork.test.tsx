// @vitest-environment jsdom

import { promptAreaMocks as mocks } from "@/test/thread-detail-prompt-area-harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThreadQueuedMessage } from "@bb/domain";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  makeThreadQueuedMessage as makeThreadQueuedMessageFixture,
  makeThreadWithRuntime as makeThread,
} from "@bb/test-helpers/domain-fixtures";
import { createDeferredPromise } from "@bb/test-helpers";
import type { ComponentProps } from "react";
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
    mocks.deleteQueuedMessageIsPending = false;
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
    document
      .querySelectorAll("[data-sent-message-editor-test-host]")
      .forEach((element) => element.remove());
    vi.clearAllMocks();
    getDefaultStore().set(quickRepliesAtom, []);
  });

  function buildPromptAreaElement({
    contextWindowUsage,
    environmentGoneStatus = null,
    queuedMessageCount = 0,
    sendPending = false,
    sendMessage = {
      isPending: sendPending,
      mutateAsync: mocks.sendMessageMutateAsync,
    },
    sentMessageEdit,
    thread = makeThread({
      id: "thr_1",
      projectId: "proj_1",
      environmentId: "env_1",
      runtime: { displayStatus: "idle" },
    }),
  }: {
    contextWindowUsage?: ComponentProps<
      typeof ThreadDetailPromptArea
    >["contextWindowUsage"];
    environmentGoneStatus?: "destroyed" | null;
    queuedMessageCount?: number;
    sendPending?: boolean;
    sendMessage?: ComponentProps<typeof ThreadDetailPromptArea>["sendMessage"];
    sentMessageEdit?: ThreadDetailSentMessageEdit;
    thread?: ReturnType<typeof makeThread>;
  } = {}) {
    return (
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
          contextWindowUsage={contextWindowUsage}
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
          sendMessage={sendMessage}
          sentMessageEdit={sentMessageEdit}
          sessionOptions={null}
          steerActiveThreadOnEnter={false}
          thread={thread}
        />
      </QueryClientProvider>
    );
  }

  function renderPromptArea(
    options: Parameters<typeof buildPromptAreaElement>[0] = {},
  ) {
    return render(buildPromptAreaElement(options));
  }

  function quickReplyButton(text: string) {
    return screen.queryByRole("button", { name: `Send “${text}”` });
  }

  function makeSendMessage(
    mutateAsync: ComponentProps<
      typeof ThreadDetailPromptArea
    >["sendMessage"]["mutateAsync"],
    isPending = false,
  ) {
    return { isPending, mutateAsync };
  }

  function makeQueuedMessage(
    overrides: Partial<ThreadQueuedMessage> = {},
  ): ThreadQueuedMessage {
    return makeThreadQueuedMessageFixture({
      id: "qmsg_1",
      threadId: "thr_1",
      content: [{ type: "text", text: "Already queued", mentions: [] }],
      model: "gpt-5",
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    });
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

  describe("source full-area assertions", () => {
    beforeEach(() => {
      getDefaultStore().set(quickRepliesAtom, ["continue"]);
    });

    it("sends continue as a queue-if-active follow-up on click", () => {
      const mutateAsync = vi.fn().mockResolvedValue(undefined);
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        sendMessage: makeSendMessage(mutateAsync),
      });

      fireEvent.click(quickReplyButton("continue")!);

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [{ type: "text", text: "continue", mentions: [] }],
          mode: "queue-if-active",
        }),
      );
      expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("compactFirst");
    });

    it("sends the pressed quick reply as the input text", () => {
      getDefaultStore().set(quickRepliesAtom, ["a", "b"]);
      const mutateAsync = vi.fn().mockResolvedValue(undefined);
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        sendMessage: makeSendMessage(mutateAsync),
      });

      fireEvent.click(quickReplyButton("b")!);

      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [{ type: "text", text: "b", mentions: [] }],
        }),
      );
    });

    it("renders no buttons when the quick replies list is empty", () => {
      getDefaultStore().set(quickRepliesAtom, []);
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("renders for an errored thread", () => {
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "error" },
        }),
      });

      expect(quickReplyButton("continue")).not.toBeNull();
    });

    it("sends once for a rapid double click", async () => {
      const send = createDeferredPromise<undefined>();
      const mutateAsync = vi.fn().mockReturnValue(send.promise);
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        sendMessage: makeSendMessage(mutateAsync),
      });

      const button = quickReplyButton("continue")!;
      fireEvent.click(button);
      fireEvent.click(button);

      expect(mutateAsync).toHaveBeenCalledTimes(1);

      await act(async () => {
        send.resolve(undefined);
      });
    });

    it("compacts first when a compaction offer is due", () => {
      const mutateAsync = vi.fn().mockResolvedValue(undefined);
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        sendMessage: makeSendMessage(mutateAsync),
        contextWindowUsage: {
          usedTokens: 150_000,
          modelContextWindow: 200_000,
          estimated: false,
          compactionOfferAt: new Date(Date.now() - 60_000).toISOString(),
        },
      });

      fireEvent.click(quickReplyButton("continue")!);

      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ compactFirst: true }),
      );
    });

    it("focuses the composer, hides while sending, and returns after a failed send", async () => {
      const send = createDeferredPromise<undefined>();
      const mutateAsync = vi.fn().mockReturnValue(send.promise);
      const thread = makeThread({
        environmentId: "env_1",
        runtime: { displayStatus: "idle" },
      });
      const { rerender } = renderPromptArea({
        thread,
        sendMessage: makeSendMessage(mutateAsync),
      });
      const focusKey = () => {
        const bottomComposer = screen
          .getAllByTestId("follow-up-prompt-box")
          .find(
            (element) =>
              !element.closest("[data-sent-message-editor-test-host]"),
          );
        expect(bottomComposer).toBeDefined();
        return within(bottomComposer!).getByTestId("focus-end-key").textContent;
      };
      const focusKeyBefore = focusKey();

      fireEvent.click(quickReplyButton("continue")!);
      rerender(
        buildPromptAreaElement({
          thread,
          sendMessage: makeSendMessage(mutateAsync, true),
        }),
      );

      expect(quickReplyButton("continue")).toBeNull();
      expect(focusKey()).not.toBe(focusKeyBefore);

      await act(async () => {
        send.reject(new Error("send failed"));
      });

      expect(mocks.toastError).toHaveBeenCalled();
      rerender(
        buildPromptAreaElement({
          thread,
          sendMessage: makeSendMessage(mutateAsync, false),
        }),
      );
      expect(quickReplyButton("continue")).not.toBeNull();

      fireEvent.click(quickReplyButton("continue")!);
      await act(async () => {});

      expect(mutateAsync).toHaveBeenCalledTimes(2);
      expect(mutateAsync.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          input: [{ type: "text", text: "continue", mentions: [] }],
        }),
      );
      expect(mocks.toastError).toHaveBeenCalledTimes(2);
    });

    it.each(["active", "stopping", "pending", "waiting-for-host"] as const)(
      "is hidden while the thread is %s",
      (displayStatus) => {
        renderPromptArea({
          thread: makeThread(
            displayStatus === "stopping"
              ? { status: "stopping" }
              : { runtime: { displayStatus } },
          ),
        });

        expect(quickReplyButton("continue")).toBeNull();
      },
    );

    it("is hidden without an environment", () => {
      renderPromptArea({
        thread: makeThread({
          environmentId: null,
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden on an archived thread", () => {
      renderPromptArea({
        thread: makeThread({
          archivedAt: 1,
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden when the environment is gone", () => {
      renderPromptArea({
        environmentGoneStatus: "destroyed",
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden during a handoff selection", () => {
      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });
      expect(quickReplyButton("continue")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Start handoff" }));

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden while a sent message is being edited", () => {
      const hostElement = document.createElement("div");
      hostElement.dataset.sentMessageEditorTestHost = "";
      document.body.append(hostElement);

      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        sentMessageEdit: {
          draft: { text: "Edited request", mentions: [], attachments: [] },
          hostElement,
          isSubmitting: false,
          operationId: "edit-operation-1",
          onCancel: vi.fn(),
          onSubmit: vi.fn(),
          updateDraft: vi.fn(),
        },
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden when the live queue holds messages", () => {
      mocks.queuedMessages = [makeQueuedMessage()];

      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        queuedMessageCount: 0,
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden when the server reports queued messages the live queue lacks", () => {
      mocks.queuedMessages = [];

      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
        queuedMessageCount: 1,
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden while a queued message action is pending", () => {
      mocks.deleteQueuedMessageIsPending = true;

      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(quickReplyButton("continue")).toBeNull();
    });

    it("is hidden while execution options are still loading", () => {
      mocks.defaultExecutionOptions = undefined;

      renderPromptArea({
        thread: makeThread({
          environmentId: "env_1",
          runtime: { displayStatus: "idle" },
        }),
      });

      expect(screen.getByTestId("submit-mode").textContent).toContain("blocked");
      expect(screen.getByTestId("prompt-stack")).toBeTruthy();
      expect(quickReplyButton("continue")).toBeNull();
    });
  });
});
