// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProjectProviderPreferencesForTests } from "./persisted-selection-fields.fork";
import {
  usePromptBoxModelPreference,
  usePromptBoxProviderPreference,
  usePromptBoxReasoningLevelPreference,
} from "./persisted-selection-fields";

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

function renderSelections() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(
    () => {
      const provider = usePromptBoxProviderPreference();
      return {
        provider,
        model: usePromptBoxModelPreference(provider.value),
        reasoning: usePromptBoxReasoningLevelPreference(provider.value),
      };
    },
    { wrapper },
  );
}

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

  it("pins legacy provider model and reasoning before another tab changes the legacy owner", () => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    window.localStorage.setItem("bb.promptbox.model", "legacy-model");
    window.localStorage.setItem("bb.promptbox.reasoning", "high");
    const first = renderSelections();
    expect(first.result.current.model.value).toBe("legacy-model");
    expect(first.result.current.reasoning.value).toBe("high");
    first.unmount();
    window.localStorage.setItem("bb.promptbox.provider", "claude-code");
    window.localStorage.removeItem("bb.promptbox.model");
    window.localStorage.removeItem("bb.promptbox.reasoning");
    const reloaded = renderSelections();
    expect(reloaded.result.current.provider.value).toBe("codex");
    expect(reloaded.result.current.model.value).toBe("legacy-model");
    expect(reloaded.result.current.reasoning.value).toBe("high");
  });

  it("does not inherit legacy selections from another provider", () => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    window.localStorage.setItem("bb.promptbox.model", "legacy-model");
    window.localStorage.setItem("bb.promptbox.reasoning", "high");
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () => ({
        model: usePromptBoxModelPreference("claude-code"),
        reasoning: usePromptBoxReasoningLevelPreference("claude-code"),
      }),
      { wrapper },
    );
    expect(result.current.model.value).toBe("");
    expect(result.current.reasoning.value).toBe("");
  });

  it.each([
    {
      model: "scoped-model",
      reasoning: "low",
    },
    {
      model: "",
      reasoning: "",
    },
  ])("prefers scoped $model/$reasoning selections over legacy values", ({ model, reasoning }) => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    window.localStorage.setItem("bb.promptbox.model", "legacy-model");
    window.localStorage.setItem("bb.promptbox.reasoning", "high");
    window.localStorage.setItem("bb.promptbox.model-codex-1", model);
    window.localStorage.setItem("bb.promptbox.reasoning-codex-1", reasoning);
    const selections = renderSelections();
    expect(selections.result.current.model.value).toBe(model);
    expect(selections.result.current.reasoning.value).toBe(reasoning);
  });
});
