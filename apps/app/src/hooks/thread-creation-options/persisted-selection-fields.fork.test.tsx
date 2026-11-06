// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProjectProviderPreferencesForTests } from "./persisted-selection-fields.fork";
import { usePromptBoxProviderPreference } from "./persisted-selection-fields";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetProjectProviderPreferencesForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("project-scoped provider preferences", () => {
  it("keeps a separate provider per project without inheriting the global pick", () => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook(
      ({ projectId }) => usePromptBoxProviderPreference(projectId),
      { wrapper, initialProps: { projectId: "project-a" } },
    );
    expect(result.current.value).toBe("");
    act(() => result.current.setValue("claude-code"));
    rerender({ projectId: "project-b" });
    expect(result.current.value).toBe("");
    act(() => result.current.setValue("acp-claude-work"));
    rerender({ projectId: "project-a" });
    expect(result.current.value).toBe("claude-code");
    expect(
      window.localStorage.getItem("bb.promptbox.provider-project-a-1"),
    ).toBe("claude-code");
    expect(
      window.localStorage.getItem("bb.promptbox.provider-project-b-1"),
    ).toBe("acp-claude-work");
    expect(window.localStorage.getItem("bb.promptbox.provider")).toBe("codex");
  });

  it("keeps missing and blank project IDs on the global provider", () => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook<
      ReturnType<typeof usePromptBoxProviderPreference>,
      { projectId: string | null | undefined }
    >(
      ({ projectId }: { projectId: string | null | undefined }) =>
        usePromptBoxProviderPreference(projectId),
      { wrapper, initialProps: { projectId: undefined } },
    );

    expect(result.current.value).toBe("codex");
    rerender({ projectId: null });
    act(() => result.current.setValue("null-global"));
    rerender({ projectId: "   " });
    expect(result.current.value).toBe("null-global");
    act(() => result.current.setValue("blank-global"));
    expect(window.localStorage.getItem("bb.promptbox.provider")).toBe(
      "blank-global",
    );

    rerender({ projectId: "project-c" });
    expect(result.current.value).toBe("");
    act(() => result.current.setValue("project-provider"));
    rerender({ projectId: undefined });
    expect(result.current.value).toBe("blank-global");
    expect(
      window.localStorage.getItem("bb.promptbox.provider-project-c-1"),
    ).toBe("project-provider");
  });
});
