// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { quickRepliesAtom } from "@/components/promptbox/banner/quick-replies-preference";
import { useQuickRepliesCard } from "./ThreadDetailPromptArea.quick-replies.fork";

type HookArgs = Parameters<typeof useQuickRepliesCard>[0];

function Harness({ args }: { args: HookArgs }) {
  return useQuickRepliesCard(args);
}

function createArgs(overrides: Partial<HookArgs> = {}): HookArgs {
  return {
    compactFirst: false,
    environmentId: "env_1",
    focusBottomPluginComposer: vi.fn(),
    followUpExecutionSelection: null,
    isFollowUpSubmitting: false,
    isHandoffSelection: false,
    isQueueMutationPending: false,
    queuedMessageCount: 0,
    queuedMessagesLength: 0,
    runtimeDisplayStatus: "idle",
    sendMessage: {
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({}),
    },
    sentMessageEditIsUndefined: true,
    setFullHistoryThreadId: vi.fn(),
    shouldHideComposer: false,
    submitMode: { kind: "ready" },
    threadId: "thr_1",
    ...overrides,
  };
}

function renderHarness(args: HookArgs, replies = ["continue"]) {
  const store = createStore();
  store.set(quickRepliesAtom, replies);
  return {
    store,
    ...render(
      <Provider store={store}>
        <Harness args={args} />
      </Provider>,
    ),
  };
}

afterEach(() => cleanup());

describe("useQuickRepliesCard", () => {
  it("returns the same node across renders while its inputs are unchanged", () => {
    const args = createArgs();
    const store = createStore();
    store.set(quickRepliesAtom, ["Continue"]);
    const { result, rerender } = renderHook(() => useQuickRepliesCard(args), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    const first = result.current;
    rerender();

    expect(first).not.toBeNull();
    expect(result.current).toBe(first);
  });

  it("returns a new node when the card visibility changes", () => {
    let args = createArgs();
    const store = createStore();
    store.set(quickRepliesAtom, ["Continue"]);
    const { result, rerender } = renderHook(() => useQuickRepliesCard(args), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    const first = result.current;

    args = createArgs({ shouldHideComposer: true });
    rerender();

    expect(first).not.toBeNull();
    expect(result.current).toBeNull();
  });

  it.each([
    ["queue mutation", { isQueueMutationPending: true }],
    ["handoff", { isHandoffSelection: true }],
    ["sent edit", { sentMessageEditIsUndefined: false }],
    ["queued submit mode", { submitMode: { kind: "queue", onStop: () => {} } }],
    [
      "blocked submit mode",
      { submitMode: { kind: "blocked", reason: "unavailable" } },
    ],
  ] satisfies readonly [string, Partial<HookArgs>][])(
    "hides for %s and returns when eligible",
    (_name, blocked) => {
      const { rerender, store } = renderHarness(createArgs(blocked));
      expect(
        screen.queryByRole("button", { name: "Send “continue”" }),
      ).toBeNull();
      rerender(
        <Provider store={store}>
          <Harness args={createArgs()} />
        </Provider>,
      );
      expect(
        screen.getByRole("button", { name: "Send “continue”" }),
      ).toBeTruthy();
    },
  );

  it("hides for empty preferences and shows a configured list", () => {
    renderHarness(createArgs(), []);
    expect(
      screen.queryByRole("button", { name: "Send “continue”" }),
    ).toBeNull();
    cleanup();
    renderHarness(createArgs(), ["continue"]);
    expect(
      screen.getByRole("button", { name: "Send “continue”" }),
    ).toBeTruthy();
  });

  it("clears full history only after success and retries after rejection", async () => {
    const first = createDeferredPromise<{}>();
    const mutateAsync = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({});
    const setFullHistoryThreadId = vi.fn();
    renderHarness(
      createArgs({
        sendMessage: { isPending: false, mutateAsync },
        setFullHistoryThreadId,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send “continue”" }));
    expect(setFullHistoryThreadId).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve({});
    });
    expect(setFullHistoryThreadId).toHaveBeenCalledExactlyOnceWith(null);
    const rejected = createDeferredPromise<{}>();
    mutateAsync.mockReturnValueOnce(rejected.promise);
    fireEvent.click(screen.getByRole("button", { name: "Send “continue”" }));
    await act(async () => {
      rejected.reject(new Error("no"));
    });
    expect(setFullHistoryThreadId).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send “continue”" }));
    expect(mutateAsync).toHaveBeenCalledTimes(3);
  });

  it.each([[false], [true]] as const)(
    "uses compactFirst %s in the built request",
    (compactFirst) => {
      const mutateAsync = vi.fn().mockResolvedValue({});
      renderHarness(
        createArgs({
          compactFirst,
          sendMessage: { isPending: false, mutateAsync },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Send “continue”" }));
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining(
          compactFirst ? { compactFirst: true } : { mode: "queue-if-active" },
        ),
      );
    },
  );
});
