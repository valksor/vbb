// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { resetProjectProviderPreferencesForTests } from "./thread-creation-options/persisted-selection-fields.fork";
import { useThreadCreationOptions } from "./useThreadCreationOptions";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";

const PROJECT_ID = "proj_prompt_defaults";
const GLOBAL_PROVIDER_ID = "global-provider";
const PROJECT_PROVIDER_ID = "project-provider";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      executionOptions: vi.fn(),
      providerStates: vi.fn(),
    },
  },
}));

function executionOptionsResponse(): SystemExecutionOptionsResponse {
  return {
    providers: [
      makeProviderInfo({
        id: GLOBAL_PROVIDER_ID,
        displayName: "Global Provider",
        logoUrl: null,
        maintenance: { health: true, usage: true, installation: false },
        composerActions: [
          { kind: "skills", trigger: "/" },
          {
            kind: "plan",
            command: { trigger: "/", name: "plan", trailingText: " " },
          },
        ],
        capabilities: {
          supportsThreadArchive: true,
          supportsThreadRename: true,
          supportsServiceTier: true,
          supportsNativeUserQuestion: true,
          supportsFork: true,
          supportsSessionRewind: true,
          modelCatalogScope: "workspace",
          permissionModes: ["accept-edits", "auto", "full"],
        },
      }),
      makeProviderInfo({
        id: PROJECT_PROVIDER_ID,
        displayName: "Project Provider",
        logoUrl: null,
        maintenance: { health: true, usage: true, installation: false },
        composerActions: [{ kind: "skills", trigger: "/" }],
        capabilities: {
          supportsThreadArchive: true,
          supportsThreadRename: true,
          supportsServiceTier: true,
          supportsNativeUserQuestion: true,
          supportsFork: true,
          supportsSessionRewind: true,
          modelCatalogScope: "workspace",
          permissionModes: ["accept-edits", "auto", "full"],
        },
      }),
    ],
    models: [
      {
        id: "global-model",
        model: "global-model",
        displayName: "Global Model",
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
      {
        id: "project-model",
        model: "project-model",
        displayName: "Project Model",
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
    ],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function providerExecutionOptionsResponse(
  providerId: string | undefined,
): SystemExecutionOptionsResponse {
  const base = executionOptionsResponse();
  const isProjectProvider = providerId === PROJECT_PROVIDER_ID;
  const modelPrefix = isProjectProvider ? "project" : "global";
  return {
    ...base,
    models: [
      {
        id: `${modelPrefix}-default`,
        model: `${modelPrefix}-default`,
        displayName: `${modelPrefix} default`,
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "" },
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: isProjectProvider ? "high" : "low",
        isDefault: true,
      },
      {
        id: `${modelPrefix}-remembered`,
        model: `${modelPrefix}-remembered`,
        displayName: `${modelPrefix} remembered`,
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
    ],
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(sdk.system.executionOptions).mockResolvedValue(
    executionOptionsResponse(),
  );
  vi.mocked(sdk.system.providerStates).mockResolvedValue({ providers: [] });
});

afterEach(() => {
  cleanup();
  resetProjectProviderPreferencesForTests();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useThreadCreationOptions", () => {
  it("remembers the provider per project instead of carrying the last pick across projects", async () => {
    const OTHER_PROJECT_ID = "proj_prompt_defaults_other";
    window.localStorage.setItem("bb.promptbox.provider", GLOBAL_PROVIDER_ID);
    vi.mocked(sdk.system.executionOptions).mockImplementation(async (args) =>
      providerExecutionOptionsResponse(args?.providerId),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ projectId }) =>
        useThreadCreationOptions({
          scope: "new-thread",
          preferenceProjectId: projectId,
          resetKey: projectId,
          initialProviderId: PROJECT_PROVIDER_ID,
        }),
      { wrapper, initialProps: { projectId: PROJECT_ID } },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe(PROJECT_PROVIDER_ID);
    });

    act(() => {
      result.current.setSelectedProviderId(GLOBAL_PROVIDER_ID);
    });
    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe(GLOBAL_PROVIDER_ID);
    });
    expect(
      window.localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.provider", PROJECT_ID),
      ),
    ).toBe(GLOBAL_PROVIDER_ID);

    rerender({ projectId: OTHER_PROJECT_ID });
    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe(PROJECT_PROVIDER_ID);
    });

    rerender({ projectId: PROJECT_ID });
    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe(GLOBAL_PROVIDER_ID);
    });
  });
});
