// @vitest-environment jsdom

import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { resetPluginFrontendBootStateForTest } from "@/lib/plugin-frontend-boot-state";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { resetPluginCssForTest } from "@/lib/plugin-css";
import { useComposer, useComposerView } from "@/lib/plugin-sdk-hooks";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { PluginContext } from "./plugin-context";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  resetPluginCssForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fork migration coverage", () => {
  it("uses the selected root project for hostless composer hooks and drafts", () => {
    const projectOne = getPromptDraftAccessor({
      kind: "new-thread",
      projectId: "proj_1",
    });
    const projectTwo = getPromptDraftAccessor({
      kind: "new-thread",
      projectId: "proj_2",
    });
    projectOne.setDraft({ text: "", mentions: [], attachments: [] });
    projectTwo.setDraft({
      text: "project two stored",
      mentions: [],
      attachments: [],
    });

    function RootFallbackProbe() {
      const [projectId, setProjectId] = useRootComposeProjectId();
      const view = useComposerView();
      const composer = useComposer();
      return (
        <div>
          <div data-testid="fallback-root-project">{projectId}</div>
          <div data-testid="fallback-view-project">
            {view.scope.kind === "new-thread" ? view.scope.projectId : "thread"}
          </div>
          <div data-testid="fallback-composer-project">
            {composer.scope.kind === "new-thread"
              ? composer.scope.projectId
              : "thread"}
          </div>
          <div data-testid="fallback-view-text">{view.draft.text}</div>
          <div data-testid="fallback-composer-text">{composer.text}</div>
          <button type="button" onClick={() => setProjectId("proj_1")}>
            select-project-one
          </button>
          <button type="button" onClick={() => setProjectId("proj_2")}>
            select-project-two
          </button>
          <button
            type="button"
            onClick={() => setProjectId(PERSONAL_PROJECT_ID)}
          >
            select-personal-project
          </button>
          <button
            type="button"
            onClick={() => composer.setText("project one written")}
          >
            write-project-one
          </button>
          <button
            type="button"
            onClick={() => composer.setText("project two written")}
          >
            write-project-two
          </button>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginContext.Provider value="demo">
          <RootFallbackProbe />
        </PluginContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("select-project-one"));
    expect(screen.getByTestId("fallback-view-project").textContent).toBe(
      "proj_1",
    );
    expect(screen.getByTestId("fallback-composer-project").textContent).toBe(
      "proj_1",
    );
    fireEvent.click(screen.getByText("write-project-one"));
    expect(projectOne.getCurrent().text).toBe("project one written");

    fireEvent.click(screen.getByText("select-project-two"));
    expect(screen.getByTestId("fallback-view-project").textContent).toBe(
      "proj_2",
    );
    expect(screen.getByTestId("fallback-composer-project").textContent).toBe(
      "proj_2",
    );
    expect(screen.getByTestId("fallback-view-text").textContent).toBe(
      "project two stored",
    );
    fireEvent.click(screen.getByText("write-project-two"));
    expect(projectTwo.getCurrent().text).toBe("project two written");

    fireEvent.click(screen.getByText("select-project-one"));
    expect(screen.getByTestId("fallback-composer-text").textContent).toBe(
      "project one written",
    );
    fireEvent.click(screen.getByText("select-personal-project"));
  });
});
