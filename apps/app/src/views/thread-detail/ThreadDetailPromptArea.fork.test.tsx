// @vitest-environment jsdom

import { promptAreaMocks as mocks } from "@/test/thread-detail-prompt-area-harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  PromptTextMention,
  ThreadTimelineModelFallback,
  ThreadWithRuntime,
} from "@bb/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  makeThreadWithRuntime as makeThreadWithRuntimeFixture,
} from "@bb/test-helpers/domain-fixtures";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyQueuedMessagesList } from "@/components/promptbox/banner/LazyQueuedMessagesList";
import {
  readThreadHandoffComposeSeedFromLocationState,
  type PromptDraftAttachment,
} from "@bb/client-core";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

vi.mock("@/hooks/usePromptDraftStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePromptDraftStorage")>()),
  usePromptDraftStorage: vi.fn(),
}));

let testQueryClient: QueryClient;

function buildPromptAreaElement({
  environmentGoneStatus = null,
  modelFallback = null,
  thread = makeThreadWithRuntimeFixture({
    environmentId: null,
    id: "thr_1",
    projectId: "proj_1",
  }),
}: {
  environmentGoneStatus?: ComponentProps<
    typeof ThreadDetailPromptArea
  >["environmentGoneStatus"];
  modelFallback?: ThreadTimelineModelFallback | null;
  thread?: ThreadWithRuntime;
} = {}) {
  return (
    <QueryClientProvider client={testQueryClient}>
      <ThreadDetailPromptArea
        activeBackgroundCommands={[]}
        activePromptMode={null}
        activeWorkflows={[]}
        childThreadsSection={null}
        composerFocusRequestKey={0}
        composerId="thread-detail-follow-up-composer"
        isPrimaryComposer
        permissionPolicy="editable"
        canRestoreEnvironment={false}
        environmentGoneStatus={environmentGoneStatus}
        goal={null}
        providerCommands={null}
        sessionOptions={null}
        modelFallback={modelFallback}
        parentThreadSection={null}
        pendingInteractions={[]}
        queuedMessageCount={0}
        pendingTodos={null}
        projectId="proj_1"
        contextEnvironmentId={null}
        resolveMentionLink={() => null}
        sendMessage={{
          isPending: false,
          mutateAsync: mocks.sendMessageMutateAsync,
        }}
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

beforeAll(() => LazyQueuedMessagesList.preload());

beforeEach(() => {
  vi.mocked(usePromptDraftStorage).mockImplementation(() => ({
    ...mocks.promptDraft,
    value: mocks.promptDraft.text,
    clear: () => {
      mocks.promptDraft.setDraft({ attachments: [], mentions: [], text: "" });
    },
    setAttachments: vi.fn(),
  }));
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.defaultExecutionOptions = null;
  mocks.executionInputSources = {};
  mocks.unknownReasoning = false;
  mocks.promptDraft.text = "";
  mocks.promptDraft.mentions = [];
  mocks.promptDraft.attachments = [];
  mocks.promptDraft.getCurrent.mockImplementation(() => ({
    attachments: mocks.promptDraft.attachments,
    mentions: mocks.promptDraft.mentions,
    text: mocks.promptDraft.text,
  }));
  mocks.promptDraft.setDraft.mockImplementation(
    (draft: {
      attachments: PromptDraftAttachment[];
      mentions: PromptTextMention[];
      text: string;
    }) => {
      mocks.promptDraft.attachments = draft.attachments;
      mocks.promptDraft.mentions = draft.mentions;
      mocks.promptDraft.text = draft.text;
    },
  );
  mocks.serviceTier = undefined;
  mocks.supportsServiceTier = false;
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea", () => {
  it("moves a handoff to the new-thread composer with its draft and execution", () => {
    mocks.promptDraft.text = "Implement the plan";
    renderPromptArea({
      thread: makeThreadWithRuntimeFixture({
        environmentId: "env_plan",
        id: "thr_1",
        projectId: "proj_1",
        title: "Plan",
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Start handoff" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Complete handoff flow" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change handoff target" }),
    );

    expect(mocks.navigate).toHaveBeenCalledOnce();
    const [path, options] = mocks.navigate.mock.calls[0] as [
      string,
      { state: unknown },
    ];
    expect(path).toBe(getRootComposeRoutePath());
    const seed = readThreadHandoffComposeSeedFromLocationState(options.state);
    expect(seed).toMatchObject({
      environmentId: "env_plan",
      model: "claude-opus-5",
      projectId: "proj_1",
      providerId: "claude-code",
      reasoningLevel: "medium",
      sourceThreadId: "thr_1",
      sourceThreadTitle: "Plan",
    });
    expect(seed?.draft.text).toBe(
      "Continue from @thread:thr_1\n\nImplement the plan",
    );
    expect(seed?.draft.mentions).toEqual([
      expect.objectContaining({
        resource: expect.objectContaining({
          kind: "thread",
          threadId: "thr_1",
        }),
      }),
    ]);
    expect(mocks.promptDraft.getCurrent().text).toBe("");
    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5");
    expect(screen.getByTestId("submit-label").textContent).toBe("");
    expect(mocks.createThreadMutateAsync).not.toHaveBeenCalled();
  });

  it("continues an environment-gone thread in the new-thread composer without reusing its environment", () => {
    mocks.promptDraft.text = "Salvage the work";
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    const thread = makeThreadWithRuntimeFixture({
      environmentId: "env_gone",
      id: "thr_1",
      projectId: "proj_1",
      title: "Gone",
    });
    const { rerender } = renderPromptArea({
      environmentGoneStatus: "destroyed",
      thread,
    });
    rerender(
      buildPromptAreaElement({
        environmentGoneStatus: "destroyed",
        modelFallback: {
          sourceSeq: 7,
          detectedAt: 123,
          originalModel: "gpt-5",
          fallbackModel: "gpt-5-mini",
          reason: "refusal",
          message: "Switched to the fallback model.",
        },
        thread,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue in new thread" }),
    );

    expect(mocks.navigate).toHaveBeenCalledOnce();
    const [path, options] = mocks.navigate.mock.calls[0] as [
      string,
      { state: unknown },
    ];
    expect(path).toBe(getRootComposeRoutePath());
    const seed = readThreadHandoffComposeSeedFromLocationState(options.state);
    expect(seed).toMatchObject({
      environmentId: null,
      model: "gpt-5-mini",
      projectId: "proj_1",
      providerId: "codex",
      reasoningLevel: "medium",
      sourceThreadId: "thr_1",
      sourceThreadTitle: "Gone",
    });
    expect(seed?.draft.text).toBe(
      "Continue from @thread:thr_1\n\nSalvage the work",
    );
    expect(mocks.promptDraft.getCurrent().text).toBe("");
  });
});
