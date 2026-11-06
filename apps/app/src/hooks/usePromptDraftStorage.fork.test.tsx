// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePromptDraftController, usePromptDraftStorage } from "./usePromptDraftStorage";

const PROJECT_A_NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-new-thread-proj_a-3";
const PROJECT_B_NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-new-thread-proj_b-3";

function storedDraft(text: string): string {
  return JSON.stringify({ text, attachments: [] });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("keeps new-thread prompt contents separate per project", () => {
    const { result, rerender } = renderHook(
      ({ projectId }) =>
        usePromptDraftStorage({ kind: "new-thread", projectId }),
      { initialProps: { projectId: "proj_a" } },
    );

    expect(result.current.storageKey).toBe(PROJECT_A_NEW_THREAD_DRAFT_KEY);
    act(() => {
      result.current.setDraft({
        text: "project a draft",
        mentions: [],
        attachments: [],
      });
    });

    rerender({ projectId: "proj_b" });
    expect(result.current.text).toBe("");

    act(() => {
      result.current.setDraft({
        text: "project b draft",
        mentions: [],
        attachments: [],
      });
    });

    rerender({ projectId: "proj_a" });
    expect(result.current.text).toBe("project a draft");
    expect(window.localStorage.getItem(PROJECT_A_NEW_THREAD_DRAFT_KEY)).toBe(
      storedDraft("project a draft"),
    );
    expect(window.localStorage.getItem(PROJECT_B_NEW_THREAD_DRAFT_KEY)).toBe(
      storedDraft("project b draft"),
    );
  });

it("shares a new-thread draft controller within a project", () => {
    const scope = { kind: "new-thread" as const, projectId: "proj_a" };
    const first = renderHook(() => usePromptDraftController(scope));
    const second = renderHook(() => usePromptDraftController(scope));

    act(() => {
      first.result.current.setDraft({
        text: "shared draft",
        mentions: [],
        attachments: [],
      });
    });

    expect(second.result.current.getCurrent().text).toBe("shared draft");
  });
