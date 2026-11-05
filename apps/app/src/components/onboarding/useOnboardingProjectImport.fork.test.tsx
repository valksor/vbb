// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useOnboardingProjectImport } from "./useOnboardingProjectImport";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

const createProject = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ mutateAsync: createProject }),
}));

const repos = [
  { name: "atlas-web", path: "/repos/atlas-web" },
  { name: "atlas-api", path: "/repos/atlas-api" },
  { name: "docs-site", path: "/repos/docs-site" },
];
const draft = getPromptDraftAccessor({
  kind: "new-thread",
  projectId: PERSONAL_PROJECT_ID,
});

function arrange(entry: "first_run" | "replay" = "first_run") {
  const store = createStore();
  const onContinue = vi.fn();
  const onSettled = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    () => ({
      ...useOnboardingProjectImport({ entry, onContinue, onSettled }),
      selection: useRootComposeProjectId(),
    }),
    { wrapper },
  );
  return { ...view, onContinue, onSettled, wrapper };
}

beforeEach(() => {
  draft.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  createProject.mockReset();
  vi.mocked(recordTelemetryEvent).mockClear();
  createProject.mockImplementation(async ({ name }: { name: string }) => ({
    id: `proj_${name}`,
  }));
});

afterEach(() => {
  cleanup();
  draft.clear();
});

describe("onboarding project imports", () => {
  it("does not preselect imports over a draft for the current project", async () => {
    draft.setTextAndMentions("Keep this draft here", []);
    const view = arrange();
    await act(() => view.result.current.importProjects("host_local", repos));
    expect(view.result.current.selection[0]).toBe(PERSONAL_PROJECT_ID);
    expect(view.onContinue).toHaveBeenCalledOnce();
  });

  it("keeps importing when the current project changes mid-import", async () => {
    const pending = createDeferredPromise<{ id: string }>();
    createProject.mockReturnValueOnce(pending.promise);
    const view = arrange();
    let imported: Promise<void>;
    act(() => {
      imported = view.result.current.importProjects("host_local", repos);
    });
    act(() => view.result.current.selection[1]("proj_existing"));
    await act(async () => {
      pending.resolve({ id: "proj_atlas-web" });
      await imported;
    });
    expect(createProject).toHaveBeenCalledTimes(repos.length);
    expect(view.onContinue).toHaveBeenCalledOnce();
    expect(view.result.current.selection[0]).toBe("proj_existing");
  });
});
