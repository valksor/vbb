// @vitest-environment jsdom

import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useHandoffComposerNavigation } from "./ThreadDetailPromptArea.handoff.fork";

const thread = { id: "thr_source", projectId: "proj_source", environmentId: "env_source" };

function renderNavigation({ isHandoffSelection }: { isHandoffSelection: boolean }) {
  const promptDraft = getPromptDraftAccessor({ kind: "thread", projectId: thread.projectId, threadId: thread.id });
  promptDraft.setDraft({ text: "Keep going", mentions: [], attachments: [] });
  const navigate = vi.fn();
  const exitHandoff = vi.fn();
  const hook = renderHook(() => useHandoffComposerNavigation({
    effectiveSelectedModel: "test-model",
    exitHandoff,
    handoffSeed: { environmentId: thread.environmentId, projectId: thread.projectId, sourceThreadId: thread.id, sourceThreadTitle: "Source thread" },
    isHandoffSelection,
    navigate,
    permissionMode: "auto",
    promptDraft,
    reasoningLevel: "high",
    selectedProviderId: "test-provider",
    serviceTier: undefined,
    sourceThreadDisplayTitle: "Source thread",
    supportsServiceTier: false,
    thread,
  }));
  return { ...hook, exitHandoff, navigate, promptDraft };
}

describe("ThreadDetailPromptArea handoff navigation", () => {
  it("captures the draft before clearing it when changing target", () => {
    const { result, navigate, promptDraft } = renderNavigation({ isHandoffSelection: true });
    act(() => result.current.moveHandoffToNewThreadComposer());
    const seed = navigate.mock.calls[0]?.[1].state.threadHandoffComposeSeed;
    expect(seed.environmentId).toBe("env_source");
    expect(seed.draft.text).toBe("Continue from @thread:thr_source\n\nKeep going");
    expect(promptDraft.getCurrent().text).toBe("");
  });

  it("continues from a gone environment with a null environment seed", () => {
    const { result, navigate } = renderNavigation({ isHandoffSelection: false });
    act(() => result.current.handleContinueInNewThread?.());
    expect(navigate.mock.calls[0]?.[1].state.threadHandoffComposeSeed.environmentId).toBeNull();
  });
});
