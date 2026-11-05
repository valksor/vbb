// @vitest-environment jsdom

import { renderHook, act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import type { NewThreadComposerState } from "@/components/promptbox/NewThreadComposer";
import {
  buildHandoffComposerSeed,
  useHandoffPromptHeader,
  useHandoffSeedApplier,
} from "./root-compose-handoff.fork";

const seed = {
  draft: { text: "Continue from @thread:thr_source", mentions: [], attachments: [] },
  environmentId: "env_source",
  model: "test-model",
  permissionMode: "auto" as const,
  projectId: "proj_source",
  providerId: "test-provider",
  reasoningLevel: "high" as const,
  serviceTier: undefined,
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Source thread",
};

describe("root compose handoff", () => {
  it("reuses an environment only in the source project", () => {
    expect(buildHandoffComposerSeed(seed, seed.projectId).environment).toEqual({ type: "reuse", environmentId: "env_source" });
    expect(buildHandoffComposerSeed(seed, "proj_target").environment).toBeUndefined();
  });

  it("applies a valid seed once and merges it into the project draft", () => {
    const target = getPromptDraftAccessor({ kind: "new-thread", projectId: seed.projectId });
    target.setDraft({ text: "Existing", mentions: [], attachments: [] });
    const setHandoffSeed = vi.fn();
    const setRootComposeProjectId = vi.fn();
    const composer = {
      seedEnvironmentSelectionValue: vi.fn(),
      setPermissionMode: vi.fn(),
      setProviderModelReasoning: vi.fn(),
      setServiceTier: vi.fn(),
    } as unknown as NewThreadComposerState;
    const { result } = renderHook(() =>
      useHandoffSeedApplier({ composer, setHandoffSeed, setRootComposeProjectId }),
    );

    act(() => result.current({ threadHandoffComposeSeed: seed }));

    expect(target.getCurrent().text).toBe("Continue from @thread:thr_source\n\nExisting");
    expect(setRootComposeProjectId).toHaveBeenCalledWith(seed.projectId);
    expect(composer.seedEnvironmentSelectionValue).toHaveBeenCalledOnce();
    act(() => result.current({ threadHandoffComposeSeed: seed }));
    expect(target.getCurrent().text).toBe("Continue from @thread:thr_source\n\nExisting");
  });

  it("cancels handoff metadata without deleting the prompt", () => {
    const target = getPromptDraftAccessor({ kind: "new-thread", projectId: seed.projectId });
    target.setDraft({ text: "Continue from @thread:thr_source\n\nExisting", mentions: [], attachments: [] });
    const setHandoffSeed = vi.fn();
    const focusPromptBox = vi.fn();
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { result } = renderHook(() =>
      useHandoffPromptHeader({ focusPromptBox, handoffSeed: seed, setHandoffSeed }),
    );

    render(<>{result.current}</>);
    fireEvent.click(screen.getByRole("button", { name: "Cancel handoff" }));

    expect(setHandoffSeed).toHaveBeenCalledWith(null);
    expect(focusPromptBox).toHaveBeenCalledOnce();
    expect(target.getCurrent().text).toBe("Continue from @thread:thr_source\n\nExisting");
    requestAnimationFrame.mockRestore();
  });
});
